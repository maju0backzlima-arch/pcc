import { availableUnits, registerSale } from "./store.js";

export function simulatePdvCatalog(store) {
  const ingredientMap = Object.fromEntries(store.ingredients.map((item) => [item.id, item]));
  return store.products.map((product) => {
    const recipeStock = availableUnits(product, ingredientMap);
    const basePrice = product.priceOverride != null ? product.priceOverride : product.price;
    const syncedPrice = Math.max(0, Number(basePrice) || 0);
    const syncedStock = Math.max(0, recipeStock);
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
    updated += 1;
  }
  store.settings.pdvAccount.lastSyncAt = new Date().toISOString();
  store.settings.pdvAccount.connected = true;
  store.settings.pdvAccount.lastError = "";
  return { updated, at: store.settings.pdvAccount.lastSyncAt };
}

function pickWeighted(products) {
  const pool = products.filter((item) => item.active !== false && item.price > 0);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function simulatePdvSale(store) {
  if (store.settings?.pdvAccount?.simulateSales === false) return null;
  const live = store.products.filter((product) => {
    const stock = store.pdvStock[product.id];
    return product.active !== false && product.price > 0 && (stock == null || stock > 0);
  });
  const product = pickWeighted(live);
  if (!product) return null;
  const qty = Math.random() > 0.72 ? 2 : 1;
  return registerSale(store, {
    source: "pdvplus",
    note: "Venda automática do PDV+",
    items: [{ productId: product.id, qty }]
  });
}
