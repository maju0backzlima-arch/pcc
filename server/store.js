import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ingredients, products, defaultSettings, users } from "../src/data/catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const storeFile = path.join(dataDir, "store.json");
const SEED_VERSION = 4;

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
    ingredients: clone(ingredients).map((item) => ({
      ...item,
      targetStock: item.targetStock ?? roundQty((item.minStock || 0) * 2.5),
      active: item.active !== false
    })),
    products: clone(products).map((product) => ({
      ...product,
      priceOverride: null,
      stockOverride: null,
      lastPdvPrice: product.price,
      lastPdvStock: null
    })),
    sales: [],
    purchases: [],
    movements: [],
    shoppingList: [],
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
  store.ingredients = (store.ingredients || []).map((item) => ({
    ...item,
    targetStock: item.targetStock ?? roundQty((item.minStock || 0) * 2.5),
    active: item.active !== false
  }));
  store.shoppingList = store.shoppingList || [];
  store.sales = (store.sales || []).slice(0, 80);
  store.purchases = (store.purchases || []).slice(0, 40);
  store.movements = (store.movements || []).slice(0, 120);
  store.pdvStock = store.pdvStock || {};
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
  const lines = Array.isArray(payload?.items) ? payload.items : [];
  const source = payload?.source || "pdvplus";
  const note = payload?.note || "";
  const at = new Date().toISOString();
  const saleItems = [];
  const consumedMap = new Map();

  for (const line of lines) {
    const product = store.products.find(
      (item) =>
        item.id === line.productId ||
        item.id === line.id ||
        item.sku === line.sku ||
        item.name === (line.name || line.nome)
    );
    const qty = Number(line.qty ?? line.quantidade ?? 1);
    if (!product || qty <= 0) continue;
    const unitPrice = product.priceOverride != null ? Number(product.priceOverride) : Number(product.price);
    for (const rec of product.recipe || []) {
      const ingredient = store.ingredients.find((item) => item.id === rec.ingredientId);
      if (!ingredient) continue;
      const used = roundQty(rec.qty * qty);
      ingredient.stock = roundQty(Math.max(0, Number(ingredient.stock) - used));
      const prev = consumedMap.get(ingredient.id) || {
        ingredientId: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
        qty: 0,
        stockAfter: 0,
        minStock: ingredient.minStock
      };
      prev.qty = roundQty(prev.qty + used);
      prev.stockAfter = ingredient.stock;
      consumedMap.set(ingredient.id, prev);
      store.movements.unshift({
        id: uid("mov"),
        at,
        type: "sale",
        ingredientId: ingredient.id,
        qty: -used,
        note: `${product.name} x${qty}`
      });
    }
    saleItems.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      qty,
      price: unitPrice,
      total: roundMoney(unitPrice * qty)
    });
  }

  if (!saleItems.length) return null;

  const sale = {
    id: uid("sale"),
    at,
    source,
    note,
    items: saleItems,
    consumed: Array.from(consumedMap.values()),
    total: roundMoney(saleItems.reduce((sum, item) => sum + item.total, 0))
  };
  store.sales.unshift(sale);
  store.sales = store.sales.slice(0, 400);
  store.movements = store.movements.slice(0, 800);
  rebuildPdvStock(store);
  rebuildShoppingList(store);
  store.settings.pdvAccount.lastSyncAt = at;
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
      product.stockOverride != null
        ? Number(product.stockOverride)
        : pdvStock != null
          ? Number(pdvStock)
          : recipeStock;
    const livePrice =
      product.priceOverride != null ? Number(product.priceOverride) : Number(product.price);
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

export { roundMoney, roundQty, availableUnits, uid, targetOf };
