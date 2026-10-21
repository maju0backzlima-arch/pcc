import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { loadStore, saveStore, withComputed } from "./store.js";
import { simulatePdvCatalog, applyPdvSync } from "./pdv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 4173);
const sessions = new Map();

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

async function start() {
  const app = express();
  app.use(express.json());

  app.get("/api/catalog", (_req, res) => {
    const store = withComputed(loadStore());
    res.json({
      storeName: store.settings.name,
      tagline: store.settings.tagline,
      syncedAt: store.settings.pdvAccount.lastSyncAt,
      products: store.products.filter((item) => item.active !== false).map(publicProduct)
    });
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

    const catalog = simulatePdvCatalog(store);
    const sync = applyPdvSync(store, catalog);
    store.settings.pdvAccount.email = user.email;
    store.settings.pdvAccount.connected = true;
    saveStore(store);

    const token = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessions.set(token, { email: user.email, name: user.name, role: user.role });
    const computed = withComputed(store);
    res.json({
      token,
      user: { email: user.email, name: user.name, role: user.role },
      sync,
      products: computed.products.map((product) => ({
        ...publicProduct(product),
        priceOverride: product.priceOverride,
        stockOverride: product.stockOverride,
        lastPdvPrice: product.lastPdvPrice,
        lastPdvStock: product.lastPdvStock
      }))
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

  app.post("/api/pdv/sync", requireAdmin, (_req, res) => {
    const store = loadStore();
    const catalog = simulatePdvCatalog(store);
    const sync = applyPdvSync(store, catalog);
    saveStore(store);
    const computed = withComputed(store);
    res.json({
      sync,
      products: computed.products.map((product) => ({
        ...publicProduct(product),
        priceOverride: product.priceOverride,
        stockOverride: product.stockOverride,
        lastPdvPrice: product.lastPdvPrice,
        lastPdvStock: product.lastPdvStock
      }))
    });
  });

  app.get("/api/admin/products", requireAdmin, (_req, res) => {
    const store = withComputed(loadStore());
    res.json({
      syncedAt: store.settings.pdvAccount.lastSyncAt,
      connected: store.settings.pdvAccount.connected,
      products: store.products.map((product) => ({
        ...publicProduct(product),
        priceOverride: product.priceOverride,
        stockOverride: product.stockOverride,
        lastPdvPrice: product.lastPdvPrice,
        lastPdvStock: product.lastPdvStock
      }))
    });
  });

  app.patch("/api/admin/products/:id", requireAdmin, (req, res) => {
    const store = loadStore();
    const product = store.products.find((item) => item.id === req.params.id);
    if (!product) return res.status(404).json({ error: "Produto não encontrado." });

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
    saveStore(store);
    const computed = withComputed(store).products.find((item) => item.id === product.id);
    res.json(computed);
  });

  app.post("/api/pdv/webhook", (req, res) => {
    const store = loadStore();
    const secret = req.headers["x-pdv-secret"] || req.body?.secret;
    if (secret !== store.settings.pdvWebhookSecret) {
      return res.status(401).json({ error: "Segredo inválido." });
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
    saveStore(store);
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

  setInterval(() => {
    const store = loadStore();
    if (store.settings.pdvAccount.autoSync === false) return;
    const catalog = simulatePdvCatalog(store);
    applyPdvSync(store, catalog);
    saveStore(store);
  }, 30000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PIC NIC ready on http://0.0.0.0:${PORT}`);
  });
}

start();
