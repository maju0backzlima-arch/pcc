import { ingredients, products, defaultSettings, users } from "./data/catalog.js";
import {
  normalizeProduto,
  baixarEstoqueProduto,
  devolverEstoqueProduto,
  gerarListaCompras,
  registrarSaidaHistorico
} from "./modules/estoque/engine.js";
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
} from "./modules/financeiro/engine.js";
import {
  defaultFiscal,
  emitirNota,
  cancelarNota,
  inutilizarFaixa,
  xmlsDoMes
} from "./modules/fiscal/engine.js";
import {
  normalizeInsumo,
  normalizeProdutoVenda,
  processarVendaPDV,
  registrarPerda,
  parseXmlNfe,
  entradaCompra,
  gerarListaComprasInsumos,
  aplicarPatchInsumo,
  aplicarPatchProduto,
  cloneInsumo,
  cloneProduto
} from "./modules/estoque/cafeteria.js";
import {
  defaultFornecedores,
  aplicarFornecedor,
  upsertFornecedor
} from "./modules/estoque/fornecedores.js";

const KEY = "picnic-local-store";
const USER_KEY = "picnic-local-user";

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

function seed() {
  return {
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
    pdvStock: {}
  };
}

function hydrate(store) {
  store.settings = { ...clone(defaultSettings), ...(store.settings || {}) };
  store.settings.financeiro = {
    ...clone(defaultFinanceiro),
    ...(store.settings.financeiro || {}),
    taxas: { ...clone(defaultFinanceiro).taxas, ...(store.settings.financeiro?.taxas || {}) },
    settlementDays: { ...clone(defaultFinanceiro).settlementDays, ...(store.settings.financeiro?.settlementDays || {}) }
  };
  store.products = (store.products || []).map((product) => normalizeProduto(normalizeProdutoVenda(product)));
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
    const next = normalizeInsumo(item);
    aplicarFornecedor(next, store, next.fornecedorId || next.fornecedor || next.supplier);
    return next;
  });
  return store;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return hydrate(JSON.parse(raw));
  } catch {}
  const store = seed();
  rebuild(store);
  save(store);
  return store;
}

function save(store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

function rebuildStock(store) {
  const map = Object.fromEntries(store.ingredients.map((item) => [item.id, item]));
  store.pdvStock = {};
  for (const product of store.products) {
    const stock = availableUnits(product, map);
    store.pdvStock[product.id] = stock;
    product.lastPdvStock = stock;
  }
}

function rebuildList(store) {
  const settings = store.settings;
  const prev = new Map((store.shoppingList || []).filter((item) => item.ingredientId).map((item) => [item.ingredientId, item]));
  const next = [];
  for (const ingredient of store.ingredients) {
    if (ingredient.active === false) continue;
    const target = Number(ingredient.targetStock || (ingredient.minStock || 0) * 2.5);
    const stock = Number(ingredient.stock) || 0;
    const min = Number(ingredient.minStock) || 0;
    const needsBuy = stock <= min || (settings.shopping?.includeSoon !== false && stock < target);
    const existing = prev.get(ingredient.id);
    if (!needsBuy && existing?.source === "manual") {
      next.push(existing);
      continue;
    }
    if (!needsBuy) continue;
    const usedIn = store.products.filter((product) => (product.recipe || []).some((row) => row.ingredientId === ingredient.id));
    let priority = "planejado";
    if (stock <= 0 || stock <= min) priority = "urgente";
    else priority = "atencao";
    const suggested = Math.max(0, roundQty(target - stock));
    const buyQty = existing?.locked ? Number(existing.buyQty) : suggested;
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
      reason:
        stock <= 0
          ? `Acabou. Usado em ${usedIn.length} item(ns) do cardápio.`
          : stock <= min
            ? `Abaixo do mínimo (${min} ${ingredient.unit}). Estoque: ${stock} ${ingredient.unit}.`
            : `Estoque caindo (${stock} de ${target} ${ingredient.unit}).`,
      usedIn: usedIn.map((item) => item.name),
      source: existing?.source === "manual" ? "manual" : "auto",
      checked: existing?.checked || false,
      locked: existing?.locked || false,
      notes: existing?.notes || "",
      updatedAt: new Date().toISOString()
    });
  }
  for (const item of store.shoppingList || []) {
    if (item.source === "manual" && !next.some((row) => row.id === item.id)) next.push(item);
  }
  const rank = { urgente: 0, atencao: 1, planejado: 2 };
  next.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || String(a.name).localeCompare(String(b.name), "pt-BR"));
  store.shoppingList = next;
}

function rebuild(store) {
  rebuildStock(store);
  rebuildList(store);
  store.settings.pdvAccount.lastSyncAt = new Date().toISOString();
  store.settings.pdvAccount.connected = true;
}

function computedProducts(store) {
  const map = Object.fromEntries(store.ingredients.map((item) => [item.id, item]));
  return store.products.map((product) => {
    const recipeStock = availableUnits(product, map);
    const liveStock =
      product.estoque_atual != null
        ? Number(product.estoque_atual)
        : product.stockOverride != null
          ? Number(product.stockOverride)
          : store.pdvStock[product.id] ?? recipeStock;
    const livePrice = product.priceOverride != null ? Number(product.priceOverride) : Number(product.preco_venda ?? product.price);
    const cost = roundMoney(
      (product.recipe || []).reduce((sum, item) => {
        const ing = map[item.ingredientId];
        return ing ? sum + ing.costPerUnit * item.qty : sum;
      }, 0)
    );
    return {
      ...product,
      price: livePrice,
      available: Math.max(0, liveStock),
      preco_custo: Number(product.preco_custo ?? cost),
      preco_venda: livePrice,
      estoque_atual: Math.max(0, liveStock),
      estoque_minimo: Number(product.estoque_minimo ?? 4),
      estoque_ideal: Number(product.estoque_ideal ?? 12),
      fornecedor: product.fornecedor || "Sem fornecedor",
      nome: product.nome || product.name,
      cost,
      margin: roundMoney(livePrice - cost),
      source: product.priceOverride != null || product.stockOverride != null ? "manual" : "pdvplus"
    };
  });
}

function summary(store) {
  const list = store.shoppingList || [];
  return {
    total: list.length,
    urgente: list.filter((item) => item.priority === "urgente").length,
    atencao: list.filter((item) => item.priority === "atencao").length,
    planejado: list.filter((item) => item.priority === "planejado").length,
    estimate: roundMoney(list.reduce((sum, item) => sum + (Number(item.estimate) || 0), 0))
  };
}

function publicSettings(settings) {
  const pdvAccount = { ...(settings?.pdvAccount || {}) };
  const hasPassword = Boolean(pdvAccount.password);
  delete pdvAccount.password;
  return { ...settings, pdvAccount: { ...pdvAccount, hasPassword } };
}

function snapshot() {
  const store = load();
  rebuild(store);
  const products = computedProducts(store);
  return {
    syncedAt: store.settings.pdvAccount.lastSyncAt,
    connected: Boolean(store.settings.pdvAccount.connected),
    settings: publicSettings(store.settings),
    products,
    ingredients: store.ingredients,
    shoppingList: store.shoppingList,
    shoppingSummary: summary(store),
    sales: store.sales.slice(0, 40),
    purchases: store.purchases.slice(0, 20),
    movements: store.movements.slice(0, 30),
    cashFlow: (store.cashFlow || []).slice(0, 80),
    expenses: store.expenses || [],
    dre: computeDre(store),
    financeiro: store.settings?.financeiro,
    listaCompras: { ...gerarListaComprasInsumos(store.ingredients || []), produtos: gerarListaCompras(store.products || []) },
    perdas: store.perdas || [],
    comprasNfe: store.comprasNfe || [],
    receivables: store.receivables || [],
    fechamentos: (store.fechamentos || []).slice(0, 30),
    caixaDia: resumoCaixaDia(store),
    notas: (store.notas || []).slice(0, 80),
    fornecedores: store.fornecedores || [],
    users: store.users.map((user) => ({ id: user.id, email: user.email, name: user.name, role: user.role, active: user.active !== false }))
  };
}

function registerSale(store, items, extra = {}) {
  const sale = processarVendaPDV(store, { items, ...extra, source: extra.source || "pdvplus" });
  if (!sale) return null;
  store.sales.unshift(sale);
  store.sales = store.sales.slice(0, 80);
  store.cashFlow = store.cashFlow || [];
  store.cashFlow.unshift(criarEntradaCaixa({ sale, metodo: sale.paymentMethod, settings: store.settings }));
  rebuild(store);
  save(store);
  return sale;
}

function json(path, options = {}) {
  const fullPath = options.path || path;
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? (typeof options.body === "string" ? JSON.parse(options.body) : options.body) : {};
  const store = load();

  if (path === "/api/catalog") {
    const products = computedProducts(store).filter((item) => item.active !== false);
    return {
      storeName: store.settings.name,
      tagline: store.settings.tagline,
      syncedAt: store.settings.pdvAccount.lastSyncAt,
      products: products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        price: product.price,
        category: product.category,
        available: product.available,
        active: product.active,
        source: product.source,
        origin: product.origin
      }))
    };
  }

  if (path === "/api/login" && method === "POST") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = store.users.find((entry) => entry.email.toLowerCase() === email && entry.password === password && entry.active !== false);
    if (!user) throw new Error("E-mail ou senha inválidos.");
    rebuild(store);
    save(store);
    const sessionUser = { email: user.email, name: user.name, role: user.role };
    try { localStorage.setItem(USER_KEY, JSON.stringify(sessionUser)); } catch {}
    return {
      token: `local-${Date.now()}`,
      user: sessionUser,
      sync: { updated: store.products.length, at: store.settings.pdvAccount.lastSyncAt },
      ...snapshot()
    };
  }

  if (path === "/api/logout") {
    try { localStorage.removeItem(USER_KEY); } catch {}
    return { ok: true };
  }
  if (path === "/api/session") {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw) return { user: JSON.parse(raw) };
    } catch {}
    const admin = store.users.find((item) => item.role === "admin" && item.active !== false) || store.users[0];
    return { user: { email: admin.email, name: admin.name, role: admin.role } };
  }

  if (path === "/api/pdv/sync" || path === "/api/admin/dashboard" || path === "/api/admin/products" || path === "/api/admin/ingredients" || path === "/api/admin/shopping") {
    if (method === "GET" || path === "/api/pdv/sync") {
      rebuild(store);
      save(store);
      return path === "/api/pdv/sync" ? { sync: { updated: store.products.length, at: store.settings.pdvAccount.lastSyncAt }, ...snapshot() } : snapshot();
    }
  }

  if (path === "/api/admin/products" && method === "POST") {
    store.products.push({
      id: uid("prd"),
      sku: String(body.sku || body.name || "").toUpperCase(),
      name: String(body.name || "Novo item"),
      price: Number(body.price || 0),
      category: String(body.category || "Outros"),
      active: true,
      recipe: body.recipe || [],
      origin: "manual",
      priceOverride: Number(body.price || 0),
      stockOverride: null,
      lastPdvPrice: Number(body.price || 0),
      lastPdvStock: null
    });
    rebuild(store);
    save(store);
    return snapshot();
  }

  const productMatch = path.match(/^\/api\/admin\/products\/([^/]+)(?:\/(archive|clone|delete))?$/);
  if (productMatch) {
    const product = store.products.find((item) => item.id === productMatch[1]);
    if (!product) throw new Error("Produto não encontrado.");
    if (productMatch[2] === "clone") {
      const copy = cloneProduto(product);
      store.products.unshift(copy);
      rebuild(store);
      save(store);
      return { clonedId: copy.id, ...snapshot() };
    }
    if (productMatch[2] === "archive" || productMatch[2] === "delete" || body.active === false) {
      product.active = false;
    } else {
      aplicarPatchProduto(product, body);
    }
    rebuild(store);
    save(store);
    return snapshot();
  }

  if (path === "/api/admin/ingredients" && method === "POST") {
    const ingredient = {
      id: uid("ing"),
      name: String(body.name || "Novo insumo"),
      nome: String(body.name || "Novo insumo"),
      unit: String(body.unit || "un"),
      unidade: String(body.unit || "un"),
      stock: Number(body.stock || 0),
      estoque_atual: Number(body.stock || 0),
      minStock: Number(body.minStock || 0),
      estoque_minimo: Number(body.minStock || 0),
      targetStock: Number(body.targetStock || 0) || roundQty(Number(body.minStock || 0) * 2.5),
      estoque_ideal: Number(body.targetStock || 0) || roundQty(Number(body.minStock || 0) * 2.5),
      costPerUnit: Number(body.costPerUnit || 0),
      custo_unitario: Number(body.costPerUnit || 0),
      category: String(body.category || "Outros"),
      supplier: String(body.supplier || body.fornecedor || ""),
      fornecedor: String(body.fornecedor || body.supplier || ""),
      fornecedorId: "",
      active: true
    };
    aplicarFornecedor(ingredient, store, body.fornecedorId || body.fornecedor || body.supplier);
    store.ingredients.push(ingredient);
    rebuild(store);
    save(store);
    return snapshot();
  }

  const ingMatch = path.match(/^\/api\/admin\/ingredients\/([^/]+)(?:\/(clone|delete))?$/);
  if (ingMatch) {
    const ingredient = store.ingredients.find((item) => item.id === ingMatch[1]);
    if (!ingredient) throw new Error("Insumo não encontrado.");
    if (ingMatch[2] === "clone") {
      const copy = cloneInsumo(ingredient);
      store.ingredients.unshift(copy);
      rebuild(store);
      save(store);
      return { clonedId: copy.id, ...snapshot() };
    }
    if (ingMatch[2] === "delete") ingredient.active = false;
    else aplicarPatchInsumo(ingredient, body, store);
    rebuild(store);
    save(store);
    return snapshot();
  }

  if (path === "/api/admin/fornecedores" && method === "POST") {
    upsertFornecedor(store, body);
    save(store);
    return snapshot();
  }

  const fornMatch = path.match(/^\/api\/admin\/fornecedores\/([^/]+)$/);
  if (fornMatch && method === "PATCH") {
    const item = upsertFornecedor(store, body, fornMatch[1]);
    if (!item) throw new Error("Fornecedor não encontrado.");
    save(store);
    return snapshot();
  }

  if (path === "/api/admin/settings") {
    if (body.shopping) store.settings.shopping = { ...store.settings.shopping, ...body.shopping };
    if (body.pdvAccount) store.settings.pdvAccount = { ...store.settings.pdvAccount, ...body.pdvAccount };
    if (body.financeiro) {
      store.settings.financeiro = {
        ...store.settings.financeiro,
        ...body.financeiro,
        taxas: { ...(store.settings.financeiro?.taxas || {}), ...(body.financeiro.taxas || {}) }
      };
    }
    rebuild(store);
    save(store);
    return snapshot();
  }

  if (path === "/api/admin/users") {
    const user = store.users[0];
    if (body.name) user.name = String(body.name);
    if (body.password) user.password = String(body.password);
    save(store);
    return { ok: true, user: { email: user.email, name: user.name, role: user.role } };
  }

  if (path === "/api/admin/sales" && method === "POST") {
    const sale = registerSale(store, body.items, { paymentMethod: body.paymentMethod, note: body.note, source: body.source || "pdvplus" });
    if (!sale) throw new Error("Informe ao menos um item válido.");
    return { sale, ...snapshot() };
  }

  if (path === "/api/admin/shopping" && method === "POST") {
    store.shoppingList.push({
      id: uid("shop"),
      ingredientId: "",
      name: String(body.name || "Item avulso"),
      unit: String(body.unit || "un"),
      category: "Avulso",
      supplier: String(body.supplier || ""),
      currentStock: 0,
      minStock: 0,
      targetStock: 0,
      neededQty: Number(body.buyQty || 1),
      buyQty: Number(body.buyQty || 1),
      costPerUnit: 0,
      estimate: 0,
      priority: "planejado",
      reason: "Item adicionado manualmente.",
      usedIn: [],
      source: "manual",
      checked: false,
      locked: true,
      notes: String(body.notes || ""),
      updatedAt: new Date().toISOString()
    });
    save(store);
    return snapshot();
  }

  const shopMatch = path.match(/^\/api\/admin\/shopping\/([^/]+)(?:\/(buy|remove))?$/);
  if (shopMatch) {
    const item = store.shoppingList.find((row) => row.id === shopMatch[1]);
    if (shopMatch[2] === "remove") {
      store.shoppingList = store.shoppingList.filter((row) => row.id !== shopMatch[1]);
      save(store);
      return snapshot();
    }
    if (shopMatch[2] === "buy") {
      if (item?.ingredientId) {
        const ingredient = store.ingredients.find((row) => row.id === item.ingredientId);
        if (ingredient) {
          const qty = Number(body.qty ?? item.buyQty);
          ingredient.stock = roundQty(Number(ingredient.stock) + qty);
          store.purchases.unshift({
            id: uid("buy"),
            at: new Date().toISOString(),
            ingredientId: ingredient.id,
            name: ingredient.name,
            qty,
            unit: ingredient.unit,
            cost: roundMoney(qty * (ingredient.costPerUnit || 0)),
            supplier: ingredient.supplier
          });
        }
      }
      store.shoppingList = store.shoppingList.filter((row) => row.id !== shopMatch[1]);
      rebuild(store);
      save(store);
      return snapshot();
    }
    if (!item) throw new Error("Item da lista não encontrado.");
    if (body.buyQty !== undefined) {
      item.buyQty = Number(body.buyQty);
      item.estimate = roundMoney(item.buyQty * (item.costPerUnit || 0));
      item.locked = true;
    }
    if (body.notes != null) item.notes = String(body.notes);
    if (body.supplier != null) item.supplier = String(body.supplier);
    save(store);
    return snapshot();
  }

  if (path === "/api/admin/shopping/rebuild") {
    rebuild(store);
    save(store);
    return snapshot();
  }

  if (path === "/api/estoque/produtos") return snapshot();

  const estqMatch = path.match(/^\/api\/estoque\/produtos\/([^/]+)$/);
  if (estqMatch && method === "PATCH") {
    const product = store.products.find((item) => item.id === estqMatch[1]);
    if (!product) throw new Error("Produto não encontrado.");
    aplicarPatchProduto(product, body);
    rebuild(store);
    save(store);
    return snapshot();
  }

  if (path === "/api/estoque/compras") {
    rebuild(store);
    save(store);
    return snapshot();
  }

  if ((path === "/api/financeiro" || String(fullPath).startsWith("/api/financeiro?")) && method === "GET") {
    refreshDespesas(store);
    const raw = String(fullPath);
    const qs = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
    const params = new URLSearchParams(qs);
    const dre = computeDre(store, params.get("from"), params.get("to"));
    return { ...snapshot(), dre };
  }

  if (path === "/api/financeiro/taxas" && method === "PATCH") {
    store.settings.financeiro = {
      ...store.settings.financeiro,
      ...body,
      taxas: { ...(store.settings.financeiro?.taxas || {}), ...(body.taxas || {}) }
    };
    save(store);
    return snapshot();
  }

  if (path === "/api/financeiro/despesas" && method === "POST") {
    const item = upsertDespesa(store, body);
    save(store);
    return { expense: item, ...snapshot() };
  }

  const despMatch = path.match(/^\/api\/financeiro\/despesas\/([^/]+)(?:\/(pagar|remover))?$/);
  if (despMatch) {
    if (despMatch[2] === "remover") {
      store.expenses = (store.expenses || []).filter((row) => row.id !== despMatch[1]);
      save(store);
      return snapshot();
    }
    if (despMatch[2] === "pagar") {
      const item = pagarDespesa(store, despMatch[1]);
      if (!item) throw new Error("Despesa não encontrada.");
      save(store);
      return { expense: item, ...snapshot() };
    }
    const item = upsertDespesa(store, body, despMatch[1]);
    if (!item) throw new Error("Despesa não encontrada.");
    save(store);
    return { expense: item, ...snapshot() };
  }

  const estornoMatch = path.match(/^\/api\/financeiro\/vendas\/([^/]+)\/estornar$/);
  if (estornoMatch && method === "POST") {
    const sale = store.sales.find((item) => item.id === estornoMatch[1]);
    if (!sale) throw new Error("Venda não encontrada.");
    if (!sale.estornada) {
      for (const line of sale.items || []) {
        const product = store.products.find((item) => item.id === line.productId);
        if (product) devolverEstoqueProduto(product, line.qty);
      }
      for (const rec of sale.consumed || []) {
        const ingredient = store.ingredients.find((item) => item.id === rec.ingredientId);
        if (ingredient) {
          ingredient.stock = roundQty(Number(ingredient.stock || 0) + Number(rec.qty || 0));
          ingredient.estoque_atual = ingredient.stock;
        }
      }
      sale.estornada = true;
      estornarEntradaCaixa(store, sale.id);
      rebuild(store);
      save(store);
    }
    return snapshot();
  }

  if (path === "/api/financeiro/lancar" && method === "POST") {
    const entry = lancarManual(store, body);
    save(store);
    return { entry, ...snapshot() };
  }

  if (path === "/api/financeiro/caixa" && method === "POST") {
    const entry = sangriaSuprimento(store, body);
    save(store);
    return { entry, ...snapshot() };
  }

  if (path === "/api/financeiro/receber" && method === "POST") {
    const item = upsertReceivable(store, body);
    save(store);
    return { receivable: item, ...snapshot() };
  }

  const recMatch = path.match(/^\/api\/financeiro\/receber\/([^/]+)(?:\/(quitar))?$/);
  if (recMatch) {
    if (recMatch[2] === "quitar") {
      const item = receberConta(store, recMatch[1]);
      if (!item) throw new Error("Conta não encontrada.");
      save(store);
      return { receivable: item, ...snapshot() };
    }
    if (method === "PATCH") {
      const item = upsertReceivable(store, body, recMatch[1]);
      if (!item) throw new Error("Conta não encontrada.");
      save(store);
      return { receivable: item, ...snapshot() };
    }
  }

  if ((path === "/api/financeiro/caixa-dia" || String(fullPath).startsWith("/api/financeiro/caixa-dia")) && method === "GET") {
    const raw = String(fullPath);
    const qs = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
    const params = new URLSearchParams(qs);
    const day = params.get("date") || new Date().toISOString().slice(0, 10);
    return { ...snapshot(), caixaDia: resumoCaixaDia(store, day) };
  }

  if (path === "/api/financeiro/conferencia" && method === "POST") {
    const fechamento = conferirFechamento(store, body);
    save(store);
    return { fechamento, ...snapshot(), caixaDia: resumoCaixaDia(store, body.date) };
  }

  if (path === "/api/fiscal/notas" && method === "GET") return snapshot();

  if (path === "/api/fiscal/emitir" && method === "POST") {
    return emitirNota(store, body.vendaId || body.saleId, body.cpf).then((nota) => {
      if (!nota) throw new Error("Venda não encontrada.");
      save(store);
      return { nota, ...snapshot() };
    });
  }

  if (path === "/api/fiscal/cancelar" && method === "POST") {
    return cancelarNota(store, body.notaId, body.justificativa, (s, sale) => {
      if (!sale || sale.estornada) return sale;
      for (const line of sale.items || []) {
        const product = s.products.find((item) => item.id === line.productId);
        if (product) devolverEstoqueProduto(product, line.qty);
      }
      for (const rec of sale.consumed || []) {
        const ingredient = s.ingredients.find((item) => item.id === rec.ingredientId);
        if (ingredient) {
          ingredient.stock = roundQty(Number(ingredient.stock || 0) + Number(rec.qty || 0));
          ingredient.estoque_atual = ingredient.stock;
        }
      }
      sale.estornada = true;
      estornarEntradaCaixa(s, sale.id);
      rebuild(s);
      return sale;
    }).then((nota) => {
      if (!nota) throw new Error("Nota não encontrada.");
      save(store);
      return { nota, ...snapshot() };
    });
  }

  if (path === "/api/fiscal/inutilizar" && method === "POST") {
    return inutilizarFaixa(store, body.numeroInicial, body.numeroFinal, body.justificativa).then((nota) => {
      save(store);
      return { nota, ...snapshot() };
    });
  }

  if ((path === "/api/fiscal/xmls" || String(fullPath).startsWith("/api/fiscal/xmls")) && method === "GET") {
    const raw = String(fullPath);
    const qs = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
    const params = new URLSearchParams(qs);
    const month = params.get("month") || new Date().toISOString().slice(0, 7);
    return { month, files: xmlsDoMes(store, month), ...snapshot() };
  }

  if (path === "/api/estoque/perdas" && method === "POST") {
    const perda = registrarPerda(store, body);
    if (!perda) throw new Error("Informe insumo e quantidade.");
    rebuild(store);
    save(store);
    return { perda, ...snapshot() };
  }

  if (path === "/api/estoque/nfe/parse" && method === "POST") {
    return parseXmlNfe(body.xml || "");
  }

  if (path === "/api/estoque/compras/entrada" && method === "POST") {
    const compra = entradaCompra(store, body);
    rebuild(store);
    save(store);
    return { compra, ...snapshot() };
  }

  if (path === "/api/config/colaboradores" && method === "POST") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !body.password) throw new Error("Informe e-mail e senha.");
    if (store.users.some((item) => item.email.toLowerCase() === email)) throw new Error("Já existe colaborador com este e-mail.");
    store.users.push({
      id: uid("usr"),
      email,
      password: String(body.password),
      name: String(body.name || email.split("@")[0]),
      role: body.role || "operador",
      active: true
    });
    save(store);
    return snapshot();
  }

  const colabMatch = path.match(/^\/api\/config\/colaboradores\/([^/]+)$/);
  if (colabMatch && method === "PATCH") {
    const user = store.users.find((item) => item.id === colabMatch[1] || item.email === colabMatch[1]);
    if (!user) throw new Error("Colaborador não encontrado.");
    if (body.name != null) user.name = String(body.name);
    if (body.role) user.role = String(body.role);
    if (body.password) user.password = String(body.password);
    if (body.active != null) user.active = Boolean(body.active);
    save(store);
    return snapshot();
  }

  return snapshot();
}

export const localApi = {
  enabled: true,
  request: json,
  snapshot,
  simulateSale() {
    const store = load();
    if (store.settings?.pdvAccount?.simulateSales !== true) return null;
    const live = computedProducts(store).filter((item) => item.active !== false && item.price > 0 && item.available > 0);
    if (!live.length) return null;
    const product = live[Math.floor(Math.random() * live.length)];
    return registerSale(store, [{ productId: product.id, qty: Math.random() > 0.72 ? 2 : 1 }]);
  }
};
