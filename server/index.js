import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import {
  loadStore,
  saveStore,
  withComputed,
  rebuildShoppingList,
  rebuildPdvStock,
  registerSale,
  applyPurchase,
  shoppingSummary,
  uid,
  roundQty,
  roundMoney
} from "./store.js";
import { simulatePdvCatalog, applyPdvSync, simulatePdvSale } from "./pdv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 4173);
const sessions = new Map();
const sseClients = new Set();

function publicProduct(product) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    price: product.price,
    category: product.category,
    available: product.available,
    active: product.active,
    source: product.source,
    origin: product.origin
  };
}

function adminProduct(product) {
  return {
    ...publicProduct(product),
    priceOverride: product.priceOverride,
    stockOverride: product.stockOverride,
    lastPdvPrice: product.lastPdvPrice,
    lastPdvStock: product.lastPdvStock,
    cost: product.cost,
    margin: product.margin,
    recipe: product.recipe || []
  };
}

function snapshot() {
  const store = withComputed(loadStore());
  return {
    syncedAt: store.settings.pdvAccount.lastSyncAt,
    connected: store.settings.pdvAccount.connected,
    settings: store.settings,
    products: store.products.map(adminProduct),
    ingredients: store.ingredients,
    shoppingList: store.shoppingList,
    shoppingSummary: shoppingSummary(store),
    sales: store.sales.slice(0, 40),
    purchases: store.purchases.slice(0, 20),
    movements: store.movements.slice(0, 30),
    users: store.users.map((user) => ({
      email: user.email,
      name: user.name,
      role: user.role
    }))
  };
}

function broadcast(event, extra = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify({ ...snapshot(), ...extra })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function authUser(req) {
  const token = String(req.headers.authorization || "").replace("Bearer ", "");
  return sessions.get(token) || null;
}

function requireAdmin(req, res, next) {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: "Faça login para continuar." });
  req.user = user;
  next();
}

function requireAdminQuery(req, res, next) {
  const token = String(req.query.token || req.headers.authorization || "").replace("Bearer ", "");
  const user = sessions.get(token);
  if (!user) return res.status(401).json({ error: "Faça login para continuar." });
  req.user = user;
  next();
}

async function start() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/catalog", (_req, res) => {
    try {
      const store = withComputed(loadStore());
      res.json({
        storeName: store.settings.name,
        tagline: store.settings.tagline,
        syncedAt: store.settings.pdvAccount.lastSyncAt,
        products: store.products.filter((item) => item.active !== false).map(publicProduct)
      });
    } catch (err) {
      res.status(500).json({ error: "Não foi possível ler o cardápio." });
    }
  });

  app.post("/api/login", (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const store = loadStore();
    const user = store.users.find(
      (entry) => entry.email.toLowerCase() === email && entry.password === password
    );
    if (!user) {
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    }

    rebuildPdvStock(store);
    const catalog = simulatePdvCatalog(store);
    const sync = applyPdvSync(store, catalog);
    rebuildShoppingList(store);
    store.settings.pdvAccount.email = user.email;
    store.settings.pdvAccount.connected = true;
    saveStore(store);
    broadcast("sync");

    const token = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessions.set(token, { email: user.email, name: user.name, role: user.role });
    res.json({
      token,
      user: { email: user.email, name: user.name, role: user.role },
      sync,
      ...snapshot()
    });
  });

  app.post("/api/logout", (req, res) => {
    const token = String(req.headers.authorization || "").replace("Bearer ", "");
    sessions.delete(token);
    res.json({ ok: true });
  });

  app.get("/api/session", (req, res) => {
    const user = authUser(req);
    if (!user) return res.status(401).json({ error: "Sessão expirada." });
    res.json({ user });
  });

  app.get("/api/admin/stream", requireAdminQuery, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  });

  app.get("/api/admin/dashboard", requireAdmin, (_req, res) => {
    res.json(snapshot());
  });

  app.post("/api/pdv/sync", requireAdmin, (_req, res) => {
    const store = loadStore();
    rebuildPdvStock(store);
    const catalog = simulatePdvCatalog(store);
    const sync = applyPdvSync(store, catalog);
    rebuildShoppingList(store);
    saveStore(store);
    broadcast("sync");
    res.json({ sync, ...snapshot() });
  });

  app.get("/api/admin/products", requireAdmin, (_req, res) => {
    res.json(snapshot());
  });

  app.post("/api/admin/products", requireAdmin, (req, res) => {
    const store = loadStore();
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Informe o nome do produto." });
    const product = {
      id: uid("prd"),
      sku: String(body.sku || name).toUpperCase(),
      name,
      price: Number(body.price || 0),
      category: String(body.category || "Outros"),
      active: body.active !== false,
      recipe: Array.isArray(body.recipe) ? body.recipe : [],
      origin: "manual",
      priceOverride: body.price != null ? Number(body.price) : null,
      stockOverride: null,
      lastPdvPrice: Number(body.price || 0),
      lastPdvStock: null
    };
    store.products.push(product);
    rebuildPdvStock(store);
    rebuildShoppingList(store);
    saveStore(store);
    broadcast("products");
    res.json(snapshot());
  });

  app.patch("/api/admin/products/:id", requireAdmin, (req, res) => {
    const store = loadStore();
    const product = store.products.find((item) => item.id === req.params.id);
    if (!product) return res.status(404).json({ error: "Produto não encontrado." });

    if (req.body.name != null) product.name = String(req.body.name).trim() || product.name;
    if (req.body.sku != null) product.sku = String(req.body.sku).trim() || product.sku;
    if (req.body.category != null) product.category = String(req.body.category);
    if (req.body.active != null) product.active = Boolean(req.body.active);
    if (Array.isArray(req.body.recipe)) product.recipe = req.body.recipe;
    if (req.body.price !== undefined && req.body.price !== "") {
      const price = Number(req.body.price);
      if (Number.isNaN(price) || price < 0) {
        return res.status(400).json({ error: "Preço inválido." });
      }
      product.priceOverride = price;
      product.price = price;
    }
    if (req.body.stock !== undefined && req.body.stock !== "") {
      const stock = Number(req.body.stock);
      if (Number.isNaN(stock) || stock < 0) {
        return res.status(400).json({ error: "Estoque inválido." });
      }
      product.stockOverride = stock;
    }
    if (req.body.clearPrice) product.priceOverride = null;
    if (req.body.clearStock) product.stockOverride = null;
    rebuildPdvStock(store);
    rebuildShoppingList(store);
    saveStore(store);
    broadcast("products");
    res.json(snapshot());
  });

  app.post("/api/admin/products/:id/archive", requireAdmin, (req, res) => {
    const store = loadStore();
    const product = store.products.find((item) => item.id === req.params.id);
    if (!product) return res.status(404).json({ error: "Produto não encontrado." });
    product.active = false;
    saveStore(store);
    broadcast("products");
    res.json(snapshot());
  });

  app.get("/api/admin/ingredients", requireAdmin, (_req, res) => {
    res.json(snapshot());
  });

  app.post("/api/admin/ingredients", requireAdmin, (req, res) => {
    const store = loadStore();
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Informe o nome do insumo." });
    store.ingredients.push({
      id: uid("ing"),
      name,
      unit: String(body.unit || "un"),
      stock: Number(body.stock || 0),
      minStock: Number(body.minStock || 0),
      targetStock: Number(body.targetStock || 0) || roundQty(Number(body.minStock || 0) * 2.5),
      costPerUnit: Number(body.costPerUnit || 0),
      category: String(body.category || "Outros"),
      supplier: String(body.supplier || ""),
      active: body.active !== false
    });
    rebuildPdvStock(store);
    rebuildShoppingList(store);
    saveStore(store);
    broadcast("ingredients");
    res.json(snapshot());
  });

  app.patch("/api/admin/ingredients/:id", requireAdmin, (req, res) => {
    const store = loadStore();
    const ingredient = store.ingredients.find((item) => item.id === req.params.id);
    if (!ingredient) return res.status(404).json({ error: "Insumo não encontrado." });
    const fields = ["name", "unit", "category", "supplier"];
    for (const field of fields) {
      if (req.body[field] != null) ingredient[field] = String(req.body[field]);
    }
    for (const field of ["stock", "minStock", "targetStock", "costPerUnit"]) {
      if (req.body[field] !== undefined && req.body[field] !== "") {
        const value = Number(req.body[field]);
        if (Number.isNaN(value) || value < 0) {
          return res.status(400).json({ error: `Valor inválido em ${field}.` });
        }
        ingredient[field] = value;
      }
    }
    if (req.body.active != null) ingredient.active = Boolean(req.body.active);
    rebuildPdvStock(store);
    rebuildShoppingList(store);
    saveStore(store);
    broadcast("ingredients");
    res.json(snapshot());
  });

  app.patch("/api/admin/settings", requireAdmin, (req, res) => {
    const store = loadStore();
    const body = req.body || {};
    if (body.name != null) store.settings.name = String(body.name);
    if (body.tagline != null) store.settings.tagline = String(body.tagline);
    if (body.pdvWebhookSecret != null) store.settings.pdvWebhookSecret = String(body.pdvWebhookSecret);
    if (body.shopping) {
      store.settings.shopping = { ...store.settings.shopping, ...body.shopping };
    }
    if (body.pdvAccount) {
      store.settings.pdvAccount = { ...store.settings.pdvAccount, ...body.pdvAccount };
    }
    rebuildShoppingList(store);
    saveStore(store);
    broadcast("settings");
    res.json(snapshot());
  });

  app.patch("/api/admin/users", requireAdmin, (req, res) => {
    const store = loadStore();
    const email = String(req.body?.email || req.user.email).trim().toLowerCase();
    const user = store.users.find((item) => item.email.toLowerCase() === email);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    if (req.body.name != null) user.name = String(req.body.name);
    if (req.body.password) user.password = String(req.body.password);
    saveStore(store);
    res.json({ ok: true, user: { email: user.email, name: user.name, role: user.role } });
  });

  app.post("/api/admin/sales", requireAdmin, (req, res) => {
    const store = loadStore();
    const sale = registerSale(store, { ...req.body, source: req.body?.source || "manual" });
    if (!sale) return res.status(400).json({ error: "Informe ao menos um item válido." });
    saveStore(store);
    broadcast("sale", { lastSale: sale });
    res.json({ sale, ...snapshot() });
  });

  app.get("/api/admin/shopping", requireAdmin, (_req, res) => {
    res.json(snapshot());
  });

  app.post("/api/admin/shopping", requireAdmin, (req, res) => {
    const store = loadStore();
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Informe o item da lista." });
    const buyQty = Number(body.buyQty || 1);
    store.shoppingList.push({
      id: uid("shop"),
      ingredientId: body.ingredientId || "",
      name,
      unit: String(body.unit || "un"),
      category: String(body.category || "Avulso"),
      supplier: String(body.supplier || ""),
      currentStock: Number(body.currentStock || 0),
      minStock: Number(body.minStock || 0),
      targetStock: Number(body.targetStock || 0),
      neededQty: buyQty,
      buyQty,
      costPerUnit: Number(body.costPerUnit || 0),
      estimate: roundMoney(buyQty * Number(body.costPerUnit || 0)),
      priority: body.priority || "planejado",
      reason: body.reason || "Item adicionado manualmente pelo lojista.",
      usedIn: [],
      source: "manual",
      checked: false,
      locked: true,
      notes: String(body.notes || ""),
      updatedAt: new Date().toISOString()
    });
    saveStore(store);
    broadcast("shopping");
    res.json(snapshot());
  });

  app.patch("/api/admin/shopping/:id", requireAdmin, (req, res) => {
    const store = loadStore();
    const item = store.shoppingList.find((row) => row.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Item da lista não encontrado." });
    if (req.body.buyQty !== undefined && req.body.buyQty !== "") {
      const buyQty = Number(req.body.buyQty);
      if (Number.isNaN(buyQty) || buyQty < 0) return res.status(400).json({ error: "Quantidade inválida." });
      item.buyQty = buyQty;
      item.estimate = roundMoney(buyQty * (item.costPerUnit || 0));
      item.locked = true;
    }
    if (req.body.notes != null) item.notes = String(req.body.notes);
    if (req.body.priority) item.priority = String(req.body.priority);
    if (req.body.checked != null) item.checked = Boolean(req.body.checked);
    if (req.body.supplier != null) item.supplier = String(req.body.supplier);
    if (req.body.name != null) item.name = String(req.body.name);
    item.updatedAt = new Date().toISOString();
    saveStore(store);
    broadcast("shopping");
    res.json(snapshot());
  });

  app.post("/api/admin/shopping/:id/buy", requireAdmin, (req, res) => {
    const store = loadStore();
    const item = store.shoppingList.find((row) => row.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Item da lista não encontrado." });
    applyPurchase(store, item, req.body?.qty);
    saveStore(store);
    broadcast("shopping");
    res.json(snapshot());
  });

  app.post("/api/admin/shopping/:id/remove", requireAdmin, (req, res) => {
    const store = loadStore();
    store.shoppingList = store.shoppingList.filter((row) => row.id !== req.params.id);
    saveStore(store);
    broadcast("shopping");
    res.json(snapshot());
  });

  app.post("/api/admin/shopping/rebuild", requireAdmin, (_req, res) => {
    const store = loadStore();
    rebuildShoppingList(store);
    saveStore(store);
    broadcast("shopping");
    res.json(snapshot());
  });

  app.post("/api/pdv/sale", (req, res) => {
    const store = loadStore();
    const secret = req.headers["x-pdv-secret"] || req.body?.secret;
    if (secret !== store.settings.pdvWebhookSecret) {
      return res.status(401).json({ error: "Segredo inválido." });
    }
    const sale = registerSale(store, { ...req.body, source: "pdvplus" });
    if (!sale) return res.status(400).json({ error: "Nenhum item reconhecido." });
    saveStore(store);
    broadcast("sale", { lastSale: sale });
    res.json({ ok: true, sale, syncedAt: store.settings.pdvAccount.lastSyncAt });
  });

  app.post("/api/pdv/webhook", (req, res) => {
    const store = loadStore();
    const secret = req.headers["x-pdv-secret"] || req.body?.secret;
    if (secret !== store.settings.pdvWebhookSecret) {
      return res.status(401).json({ error: "Segredo inválido." });
    }
    const sales = req.body?.sales || req.body?.vendas;
    if (Array.isArray(sales) && sales.length) {
      const applied = [];
      for (const sale of sales) {
        const result = registerSale(store, { ...sale, source: "pdvplus" });
        if (result) applied.push(result);
      }
      saveStore(store);
      broadcast("sale", { lastSale: applied[0] || null });
      return res.json({ ok: true, sales: applied.length, syncedAt: store.settings.pdvAccount.lastSyncAt });
    }
    const items = req.body?.items || req.body?.produtos || [];
    let changed = 0;
    for (const item of items) {
      const product = store.products.find(
        (entry) =>
          entry.id === item.id ||
          entry.sku === item.sku ||
          entry.name === (item.name || item.nome)
      );
      if (!product) continue;
      if (item.price != null || item.preco != null) {
        const price = Number(item.price ?? item.preco);
        product.lastPdvPrice = price;
        if (product.priceOverride == null) product.price = price;
        changed += 1;
      }
      if (item.stock != null || item.estoque != null) {
        const stock = Number(item.stock ?? item.estoque);
        store.pdvStock[product.id] = stock;
        product.lastPdvStock = stock;
        changed += 1;
      }
    }
    store.settings.pdvAccount.lastSyncAt = new Date().toISOString();
    rebuildShoppingList(store);
    saveStore(store);
    broadcast("sync");
    res.json({ ok: true, changed, syncedAt: store.settings.pdvAccount.lastSyncAt });
  });

  if (process.env.NODE_ENV === "production") {
    const dist = path.join(root, "dist");
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    const vite = await createViteServer({
      root,
      server: {
        middlewareMode: true,
        allowedHosts: [".monkeycode-ai.live"]
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Rota não encontrada." });
  });

  app.use((err, req, res, next) => {
    console.error(err);
    if (req.path.startsWith("/api")) {
      return res.status(500).json({ error: err.message || "Erro interno." });
    }
    next(err);
  });

  setInterval(() => {
    try {
      const store = loadStore();
      if (store.settings.pdvAccount.autoSync === false) return;
      let sale = null;
      if (store.settings.pdvAccount.simulateSales !== false) {
        sale = simulatePdvSale(store);
      }
      if (!sale) {
        rebuildPdvStock(store);
        const catalog = simulatePdvCatalog(store);
        applyPdvSync(store, catalog);
        rebuildShoppingList(store);
      }
      saveStore(store);
      broadcast(sale ? "sale" : "sync", sale ? { lastSale: sale } : {});
    } catch (err) {
      console.error("Falha no ciclo PDV+:", err.message);
    }
  }, 20000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PIC NIC ready on http://0.0.0.0:${PORT}`);
  });
}

start();
