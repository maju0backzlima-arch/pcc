import { roundMoney, availableUnits } from "./store.js";

function jitter(base, amount) {
  const delta = (Math.sin(Date.now() / 180000 + base * 7.13) + 1) / 2;
  return roundMoney(base + (delta - 0.5) * amount);
}

export function simulatePdvCatalog(store) {
  const ingredientMap = Object.fromEntries(store.ingredients.map((item) => [item.id, item]));
  return store.products.map((product, index) => {
    const recipeStock = availableUnits(product, ingredientMap);
    const cached = store.pdvCatalog.find((item) => item.id === product.id);
    const basePrice = cached?.price ?? product.lastPdvPrice ?? product.price;
    const syncedPrice = Math.max(0, jitter(basePrice, product.price >= 10 ? 1 : 0.4));
    const syncedStock = Math.max(0, Math.round(jitter(recipeStock, 3)));
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      price: syncedPrice,
      stock: syncedStock
    };
  });
}

export function applyPdvSync(store, catalog) {
  store.pdvCatalog = catalog.map((item) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    price: item.price,
    category: item.category
  }));
  store.pdvStock = {};
  let updated = 0;
  for (const item of catalog) {
    const product = store.products.find((entry) => entry.id === item.id);
    if (!product) continue;
    store.pdvStock[item.id] = item.stock;
    product.lastPdvPrice = item.price;
    product.lastPdvStock = item.stock;
    if (product.priceOverride == null) {
      product.price = item.price;
    }
    if (product.stockOverride == null) {
      updated += 1;
    } else {
      updated += 1;
    }
  }
  store.settings.pdvAccount.lastSyncAt = new Date().toISOString();
  store.settings.pdvAccount.connected = true;
  store.settings.pdvAccount.lastError = "";
  return { updated, at: store.settings.pdvAccount.lastSyncAt };
}
