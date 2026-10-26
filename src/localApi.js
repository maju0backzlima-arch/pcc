import { ingredients, products, defaultSettings, users } from "./data/catalog.js";

const KEY = "picnic-local-store";

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
    pdvStock: {}
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
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
    const liveStock = product.stockOverride != null ? Number(product.stockOverride) : store.pdvStock[product.id] ?? recipeStock;
    const livePrice = product.priceOverride != null ? Number(product.priceOverride) : Number(product.price);
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

function snapshot() {
  const store = load();
  rebuild(store);
  const products = computedProducts(store);
  return {
    syncedAt: store.settings.pdvAccount.lastSyncAt,
    connected: true,
    settings: store.settings,
    products,
    ingredients: store.ingredients,
    shoppingList: store.shoppingList,
    shoppingSummary: summary(store),
    sales: store.sales.slice(0, 40),
    purchases: store.purchases.slice(0, 20),
    movements: store.movements.slice(0, 30),
    users: store.users.map((user) => ({ email: user.email, name: user.name, role: user.role }))
  };
}

function registerSale(store, items) {
  const at = new Date().toISOString();
  const saleItems = [];
  const consumedMap = new Map();
  for (const line of items || []) {
    const product = store.products.find((item) => item.id === line.productId || item.id === line.id);
    const qty = Number(line.qty || 1);
    if (!product || qty <= 0) continue;
    const unitPrice = product.priceOverride != null ? Number(product.priceOverride) : Number(product.price);
    for (const rec of product.recipe || []) {
      const ingredient = store.ingredients.find((item) => item.id === rec.ingredientId);
      if (!ingredient) continue;
      const used = roundQty(rec.qty * qty);
      ingredient.stock = roundQty(Math.max(0, Number(ingredient.stock) - used));
      const prev = consumedMap.get(ingredient.id) || { ingredientId: ingredient.id, name: ingredient.name, unit: ingredient.unit, qty: 0 };
      prev.qty = roundQty(prev.qty + used);
      consumedMap.set(ingredient.id, prev);
    }
    saleItems.push({ productId: product.id, sku: product.sku, name: product.name, qty, price: unitPrice, total: roundMoney(unitPrice * qty) });
  }
  if (!saleItems.length) return null;
  const sale = {
    id: uid("sale"),
    at,
    source: "pdvplus",
    items: saleItems,
    consumed: Array.from(consumedMap.values()),
    total: roundMoney(saleItems.reduce((sum, item) => sum + item.total, 0))
  };
  store.sales.unshift(sale);
  store.sales = store.sales.slice(0, 80);
  rebuild(store);
  save(store);
  return sale;
}

function json(path, options = {}) {
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
    const user = store.users.find((entry) => entry.email.toLowerCase() === email && entry.password === password);
    if (!user) throw new Error("E-mail ou senha inválidos.");
    rebuild(store);
    save(store);
    return {
      token: `local-${Date.now()}`,
      user: { email: user.email, name: user.name, role: user.role },
      sync: { updated: store.products.length, at: store.settings.pdvAccount.lastSyncAt },
      ...snapshot()
    };
  }

  if (path === "/api/logout") return { ok: true };
  if (path === "/api/session") {
    return { user: { email: "loja@picnic.com", name: "Lojista PIC NIC", role: "admin" } };
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

  const productMatch = path.match(/^\/api\/admin\/products\/([^/]+)(?:\/(archive))?$/);
  if (productMatch) {
    const product = store.products.find((item) => item.id === productMatch[1]);
    if (!product) throw new Error("Produto não encontrado.");
    if (productMatch[2] === "archive" || body.active === false) product.active = false;
    else {
      if (body.name != null) product.name = String(body.name);
      if (body.sku != null) product.sku = String(body.sku);
      if (body.category != null) product.category = String(body.category);
      if (body.active != null) product.active = Boolean(body.active);
      if (Array.isArray(body.recipe)) product.recipe = body.recipe;
      if (body.price !== undefined && body.price !== "") {
        product.priceOverride = Number(body.price);
        product.price = Number(body.price);
      }
      if (body.stock !== undefined && body.stock !== "") product.stockOverride = Number(body.stock);
      if (body.clearPrice) product.priceOverride = null;
      if (body.clearStock) product.stockOverride = null;
    }
    rebuild(store);
    save(store);
    return snapshot();
  }

  if (path === "/api/admin/ingredients" && method === "POST") {
    store.ingredients.push({
      id: uid("ing"),
      name: String(body.name || "Novo insumo"),
      unit: String(body.unit || "un"),
      stock: Number(body.stock || 0),
      minStock: Number(body.minStock || 0),
      targetStock: Number(body.targetStock || 0) || roundQty(Number(body.minStock || 0) * 2.5),
      costPerUnit: Number(body.costPerUnit || 0),
      category: String(body.category || "Outros"),
      supplier: String(body.supplier || ""),
      active: true
    });
    rebuild(store);
    save(store);
    return snapshot();
  }

  const ingMatch = path.match(/^\/api\/admin\/ingredients\/([^/]+)$/);
  if (ingMatch) {
    const ingredient = store.ingredients.find((item) => item.id === ingMatch[1]);
    if (!ingredient) throw new Error("Insumo não encontrado.");
    for (const field of ["name", "unit", "category", "supplier"]) {
      if (body[field] != null) ingredient[field] = String(body[field]);
    }
    for (const field of ["stock", "minStock", "targetStock", "costPerUnit"]) {
      if (body[field] !== undefined && body[field] !== "") ingredient[field] = Number(body[field]);
    }
    rebuild(store);
    save(store);
    return snapshot();
  }

  if (path === "/api/admin/settings") {
    if (body.shopping) store.settings.shopping = { ...store.settings.shopping, ...body.shopping };
    if (body.pdvAccount) store.settings.pdvAccount = { ...store.settings.pdvAccount, ...body.pdvAccount };
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
    const sale = registerSale(store, body.items);
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

  return snapshot();
}

export const localApi = {
  enabled: true,
  request: json,
  snapshot,
  simulateSale() {
    const store = load();
    const live = computedProducts(store).filter((item) => item.active !== false && item.price > 0 && item.available > 0);
    if (!live.length) return null;
    const product = live[Math.floor(Math.random() * live.length)];
    return registerSale(store, [{ productId: product.id, qty: Math.random() > 0.72 ? 2 : 1 }]);
  }
};
