import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ingredients, products, defaultSettings, users } from "../src/data/catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const storeFile = path.join(dataDir, "store.json");
const SEED_VERSION = 3;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function availableUnits(product, ingredientMap) {
  const qty = (product.recipe || []).map((item) => {
    const ing = ingredientMap[item.ingredientId];
    if (!ing || !item.qty) return 0;
    return Math.floor(ing.stock / item.qty);
  });
  return qty.length ? Math.max(0, Math.min(...qty)) : 999;
}

export function seedStore() {
  return {
    seedVersion: SEED_VERSION,
    ingredients: clone(ingredients),
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

function hydrate(store) {
  if (!store || store.seedVersion !== SEED_VERSION || !store.products?.length) {
    return seedStore();
  }
  store.settings = { ...clone(defaultSettings), ...(store.settings || {}) };
  store.settings.pdvAccount = {
    ...clone(defaultSettings).pdvAccount,
    ...(store.settings.pdvAccount || {})
  };
  return store;
}

export function loadStore() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storeFile)) {
    const seeded = seedStore();
    saveStore(seeded);
    return seeded;
  }
  try {
    const parsed = hydrate(JSON.parse(fs.readFileSync(storeFile, "utf8")));
    saveStore(parsed);
    return parsed;
  } catch {
    const seeded = seedStore();
    saveStore(seeded);
    return seeded;
  }
}

export function saveStore(store) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));
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

export { roundMoney, availableUnits };
