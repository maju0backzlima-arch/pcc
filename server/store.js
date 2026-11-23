import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ingredients, products, defaultSettings, users } from "../src/data/catalog.js";
import {
  normalizeProduto,
  baixarEstoqueProduto,
  devolverEstoqueProduto,
  gerarListaCompras as buildListaCompras,
  registrarSaidaHistorico
} from "../src/modules/estoque/engine.js";
import {
  defaultFinanceiro,
  criarEntradaCaixa,
  estornarEntradaCaixa,
  refreshDespesas,
  computeDre,
  upsertDespesa,
  pagarDespesa,
  defaultExpenses,
  lancarManual,
  upsertReceivable,
  receberConta,
  sangriaSuprimento,
  conferirFechamento,
  resumoCaixaDia
} from "../src/modules/financeiro/engine.js";
import {
  defaultFiscal,
  emitirNota,
  cancelarNota,
  inutilizarFaixa,
  notasDoMes,
  xmlsDoMes
} from "../src/modules/fiscal/engine.js";
import {
  normalizeInsumo,
  normalizeProdutoVenda,
  processarVendaPDV,
  registrarPerda,
  parseXmlNfe,
  entradaCompra,
  gerarListaComprasInsumos
} from "../src/modules/estoque/cafeteria.js";
import {
  defaultFornecedores,
  aplicarFornecedor,
  upsertFornecedor
} from "../src/modules/estoque/fornecedores.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const storeFile = path.join(dataDir, "store.json");
const SEED_VERSION = 7;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function availableUnits(product, ingredientMap) {
  const qty = (product.recipe || []).map((item) => {
    const ing = ingredientMap[item.ingredientId];
    if (!ing || !item.qty) return 0;
    return Math.floor(ing.stock / item.qty);
  });
  return qty.length ? Math.max(0, Math.min(...qty)) : 999;
}

function targetOf(ingredient, settings) {
  if (ingredient.targetStock != null && ingredient.targetStock > 0) {
    return Number(ingredient.targetStock);
  }
  const mult = Number(settings?.shopping?.targetMultiplier || 2.5);
  return roundQty(Number(ingredient.minStock || 0) * mult);
}

function productsUsing(store, ingredientId) {
  return store.products.filter((product) =>
    (product.recipe || []).some((item) => item.ingredientId === ingredientId)
  );
}

export function seedStore() {
  return {
    seedVersion: SEED_VERSION,
    ingredients: clone(ingredients).map((item) => normalizeInsumo({
      ...item,
      targetStock: item.targetStock ?? roundQty((item.minStock || 0) * 2.5),
      active: item.active !== false
    })),
    products: clone(products).map((product) => ({
      ...normalizeProduto(normalizeProdutoVenda(product)),
      priceOverride: null,
      stockOverride: product.estoque_atual ?? null,
      lastPdvPrice: product.price,
      lastPdvStock: product.estoque_atual ?? null
    })),
    sales: [],
    purchases: [],
    movements: [],
    shoppingList: [],
    cashFlow: [],
    expenses: defaultExpenses(),
    receivables: [],
    perdas: [],
    comprasNfe: [],
    notes: [],
    fechamentos: [],
    notas: [],
    fornecedores: clone(defaultFornecedores),
    settings: clone(defaultSettings),
    users: clone(users),
    pdvCatalog: clone(products).map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      price: product.price,
      category: product.category
    })),
    pdvStock: {}
  };
}

let memory = null;
let saveTimer = null;

function hydrate(store) {
  if (!store || store.seedVersion !== SEED_VERSION || !store.products?.length) {
    const seeded = seedStore();
    rebuildShoppingList(seeded);
    return seeded;
  }
  store.settings = { ...clone(defaultSettings), ...(store.settings || {}) };
  store.settings.pdvAccount = {
    ...clone(defaultSettings).pdvAccount,
    ...(store.settings.pdvAccount || {})
  };
  store.settings.shopping = {
    ...clone(defaultSettings).shopping,
    ...(store.settings.shopping || {})
  };
  store.settings.financeiro = {
    ...clone(defaultFinanceiro),
    ...(store.settings.financeiro || {}),
    taxas: {
      ...clone(defaultFinanceiro).taxas,
      ...(store.settings.financeiro?.taxas || {})
    },
    settlementDays: {
      ...clone(defaultFinanceiro).settlementDays,
      ...(store.settings.financeiro?.settlementDays || {})
    }
  };
  store.shoppingList = store.shoppingList || [];
  store.sales = (store.sales || []).slice(0, 80);
  store.purchases = (store.purchases || []).slice(0, 40);
  store.movements = (store.movements || []).slice(0, 120);
  store.pdvStock = store.pdvStock || {};
  store.cashFlow = store.cashFlow || [];
  store.expenses = store.expenses?.length ? store.expenses : defaultExpenses();
  store.receivables = store.receivables || [];
  store.perdas = store.perdas || [];
  store.comprasNfe = store.comprasNfe || [];
  store.notes = store.notes || [];
  store.fechamentos = store.fechamentos || [];
  store.notas = store.notas || [];
  store.fornecedores = store.fornecedores?.length ? store.fornecedores : clone(defaultFornecedores);
  store.settings.fiscal = { ...defaultFiscal(), ...(store.settings.fiscal || {}) };
  store.ingredients = (store.ingredients || []).map((item) => {
    const next = normalizeInsumo({
      ...item,
      targetStock: item.targetStock ?? roundQty((item.minStock || 0) * 2.5),
      active: item.active !== false
    });
    aplicarFornecedor(next, store, next.fornecedorId || next.fornecedor || next.supplier);
    return next;
  });
  store.products = (store.products || []).map((product) => normalizeProduto(normalizeProdutoVenda(product)));
  store.users = (store.users || []).map((user) => ({
    ...user,
    id: user.id || `usr-${String(user.email || "").split("@")[0]}`,
    active: user.active !== false,
    role: user.role || "operador"
  }));
  return store;
}

export function loadStore() {
  if (memory) return memory;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storeFile)) {
    memory = seedStore();
    rebuildShoppingList(memory);
    persistNow(memory);
    return memory;
  }
  try {
    memory = hydrate(JSON.parse(fs.readFileSync(storeFile, "utf8")));
    return memory;
  } catch {
    memory = seedStore();
    rebuildShoppingList(memory);
    persistNow(memory);
    return memory;
  }
}

function persistNow(store) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${storeFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, storeFile);
}

export function saveStore(store) {
  memory = store;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      persistNow(memory);
    } catch (err) {
      console.error("Falha ao gravar estoque:", err.message);
    }
  }, 400);
}

export function rebuildPdvStock(store) {
  const ingredientMap = Object.fromEntries(store.ingredients.map((item) => [item.id, item]));
  store.pdvStock = {};
  for (const product of store.products) {
    const recipeStock = availableUnits(product, ingredientMap);
    store.pdvStock[product.id] = recipeStock;
    product.lastPdvStock = recipeStock;
  }
}

export function rebuildShoppingList(store) {
  const settings = store.settings || defaultSettings;
  const autoGenerate = settings.shopping?.autoGenerate !== false;
  const byIngredient = new Map(
    (store.shoppingList || [])
      .filter((item) => item.ingredientId)
      .map((item) => [item.ingredientId, item])
  );
  const next = [];

  if (autoGenerate) {
    for (const ingredient of store.ingredients) {
      if (ingredient.active === false) continue;
      const target = targetOf(ingredient, settings);
      const stock = Number(ingredient.stock) || 0;
      const min = Number(ingredient.minStock) || 0;
      const includeSoon = settings.shopping?.includeSoon !== false;
      const soonLimit = min * Number(settings.shopping?.soonFactor || 1.25);
      const needsBuy = stock <= min || (includeSoon && stock < target);
      const existing = byIngredient.get(ingredient.id);
      if (!needsBuy && existing?.source === "auto" && !existing.locked) continue;
      if (!needsBuy && !existing) continue;
      if (!needsBuy && existing?.source === "manual") {
        next.push(existing);
        continue;
      }

      const usedIn = productsUsing(store, ingredient.id);
      let priority = "planejado";
      if (stock <= 0) priority = "urgente";
      else if (stock <= min) priority = "urgente";
      else if (stock <= soonLimit) priority = "atencao";

      const suggested = Math.max(0, roundQty(target - stock));
      const buyQty = existing?.locked ? Number(existing.buyQty) : suggested;
      const reason =
        stock <= 0
          ? `Acabou. Usado em ${usedIn.length} item(ns) do cardápio. Sem esse insumo o PDV+ não consegue produzir.`
          : stock <= min
            ? `Abaixo do mínimo (${min} ${ingredient.unit}). Estoque atual: ${stock} ${ingredient.unit}. Usado em ${usedIn.length} item(ns).`
            : `Estoque caindo (${stock} ${ingredient.unit} de ${target} ${ingredient.unit} de meta). Usado em ${usedIn.length} item(ns).`;

      next.push({
        id: existing?.id || uid("shop"),
        ingredientId: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
        category: ingredient.category,
        supplier: ingredient.supplier,
        currentStock: stock,
        minStock: min,
        targetStock: target,
        neededQty: suggested,
        buyQty,
        costPerUnit: ingredient.costPerUnit,
        estimate: roundMoney(buyQty * (ingredient.costPerUnit || 0)),
        priority,
        reason,
        usedIn: usedIn.map((item) => item.name),
        source: existing?.source === "manual" ? "manual" : "auto",
        checked: existing?.checked || false,
        locked: existing?.locked || false,
        notes: existing?.notes || "",
        updatedAt: new Date().toISOString()
      });
    }
  }

  for (const item of store.shoppingList || []) {
    if (item.source === "manual" && !item.ingredientId) {
      next.push(item);
    } else if (item.source === "manual" && item.ingredientId && !next.some((row) => row.id === item.id)) {
      next.push({ ...item, currentStock: store.ingredients.find((ing) => ing.id === item.ingredientId)?.stock ?? item.currentStock });
    }
  }

  const rank = { urgente: 0, atencao: 1, planejado: 2 };
  next.sort((a, b) => {
    const pr = (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
    if (pr !== 0) return pr;
    return String(a.name).localeCompare(String(b.name), "pt-BR");
  });
  store.shoppingList = next;
  return next;
}

export function registerSale(store, payload) {
  const sale = processarVendaPDV(store, payload);
  if (!sale) return null;
  store.sales.unshift(sale);
  store.sales = store.sales.slice(0, 400);
  store.movements = store.movements.slice(0, 800);
  store.cashFlow = store.cashFlow || [];
  store.cashFlow.unshift(criarEntradaCaixa({ sale, metodo: sale.paymentMethod, settings: store.settings }));
  store.cashFlow = store.cashFlow.slice(0, 800);
  rebuildPdvStock(store);
  rebuildShoppingList(store);
  store.settings.pdvAccount.lastSyncAt = sale.at;
  store.settings.pdvAccount.connected = true;
  return sale;
}

export function applyPurchase(store, listItem, qty) {
  const buyQty = qty != null ? Number(qty) : Number(listItem.buyQty);
  if (!listItem.ingredientId || !(buyQty > 0)) {
    listItem.checked = true;
    return listItem;
  }
  const ingredient = store.ingredients.find((item) => item.id === listItem.ingredientId);
  if (!ingredient) return listItem;
  const at = new Date().toISOString();
  ingredient.stock = roundQty(Number(ingredient.stock) + buyQty);
  const purchase = {
    id: uid("buy"),
    at,
    ingredientId: ingredient.id,
    name: ingredient.name,
    qty: buyQty,
    unit: ingredient.unit,
    cost: roundMoney(buyQty * (ingredient.costPerUnit || 0)),
    supplier: ingredient.supplier
  };
  store.purchases.unshift(purchase);
  store.movements.unshift({
    id: uid("mov"),
    at,
    type: "purchase",
    ingredientId: ingredient.id,
    qty: buyQty,
    note: "Compra da lista de mercado"
  });
  store.shoppingList = store.shoppingList.filter((item) => item.id !== listItem.id);
  rebuildPdvStock(store);
  rebuildShoppingList(store);
  return purchase;
}

export function withComputed(store) {
  const ingredientMap = Object.fromEntries(store.ingredients.map((item) => [item.id, item]));
  const productsComputed = store.products.map((product) => {
    const pdvStock = store.pdvStock[product.id];
    const recipeStock = availableUnits(product, ingredientMap);
    const liveStock =
      product.estoque_atual != null
        ? Number(product.estoque_atual)
        : product.stockOverride != null
          ? Number(product.stockOverride)
          : pdvStock != null
            ? Number(pdvStock)
            : recipeStock;
    const livePrice =
      product.priceOverride != null ? Number(product.priceOverride) : Number(product.preco_venda ?? product.price);
    const cost = roundMoney(
      (product.recipe || []).reduce((sum, item) => {
        const ing = ingredientMap[item.ingredientId];
        return ing ? sum + ing.costPerUnit * item.qty : sum;
      }, 0)
    );
    return {
      ...product,
      price: livePrice,
      available: Math.max(0, liveStock),
      cost,
      preco_custo: Number(product.preco_custo ?? cost),
      preco_venda: livePrice,
      estoque_atual: Math.max(0, liveStock),
      estoque_minimo: Number(product.estoque_minimo ?? 4),
      estoque_ideal: Number(product.estoque_ideal ?? 12),
      fornecedor: product.fornecedor || "Sem fornecedor",
      nome: product.nome || product.name,
      margin: roundMoney(livePrice - cost),
      source: product.priceOverride != null || product.stockOverride != null ? "manual" : "pdvplus"
    };
  });
  return { ...store, products: productsComputed };
}

export function shoppingSummary(store) {
  const list = store.shoppingList || [];
  return {
    total: list.length,
    urgente: list.filter((item) => item.priority === "urgente").length,
    atencao: list.filter((item) => item.priority === "atencao").length,
    planejado: list.filter((item) => item.priority === "planejado").length,
    estimate: roundMoney(list.reduce((sum, item) => sum + (Number(item.estimate) || 0), 0))
  };
}

export function handlePdvSale(store, venda) {
  return registerSale(store, { ...venda, source: venda?.source || "pdvplus" });
}

export function gerarListaCompras(store) {
  const produtos = buildListaCompras(store.products || []);
  const insumos = gerarListaComprasInsumos(store.ingredients || []);
  return { ...insumos, produtos };
}

export function financeSnapshot(store, from, to) {
  refreshDespesas(store);
  const day = new Date().toISOString().slice(0, 10);
  return {
    cashFlow: (store.cashFlow || []).slice(0, 80),
    expenses: store.expenses || [],
    dre: computeDre(store, from, to),
    financeiro: store.settings?.financeiro || defaultFinanceiro,
    receivables: store.receivables || [],
    fechamentos: (store.fechamentos || []).slice(0, 30),
    caixaDia: resumoCaixaDia(store, day)
  };
}

export function reverseSaleStock(store, sale) {
  if (!sale || sale.estornada) return sale;
  for (const line of sale.items || []) {
    const product = store.products.find((item) => item.id === line.productId);
    if (!product) continue;
    devolverEstoqueProduto(product, line.qty);
  }
  for (const rec of sale.consumed || []) {
    const ingredient = store.ingredients.find((item) => item.id === rec.ingredientId);
    if (!ingredient) continue;
    ingredient.stock = roundQty(Number(ingredient.stock || 0) + Number(rec.qty || 0));
    ingredient.estoque_atual = ingredient.stock;
  }
  sale.estornada = true;
  estornarEntradaCaixa(store, sale.id);
  rebuildPdvStock(store);
  rebuildShoppingList(store);
  return sale;
}

export {
  roundMoney,
  roundQty,
  availableUnits,
  uid,
  targetOf,
  computeDre,
  upsertDespesa,
  pagarDespesa,
  refreshDespesas,
  estornarEntradaCaixa,
  lancarManual,
  upsertReceivable,
  receberConta,
  sangriaSuprimento,
  conferirFechamento,
  resumoCaixaDia,
  registrarPerda,
  parseXmlNfe,
  entradaCompra,
  gerarListaComprasInsumos,
  emitirNota,
  cancelarNota,
  inutilizarFaixa,
  notasDoMes,
  xmlsDoMes,
  upsertFornecedor,
  aplicarFornecedor
};
