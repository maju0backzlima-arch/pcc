function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const defaultFornecedores = [
  { id: "forn-torrefacao", name: "Torrefação", whatsapp: "11940001001", categoria: "Bebidas", prazoDias: 3 },
  { id: "forn-laticinio", name: "Laticínio Vale", whatsapp: "11940001002", categoria: "Laticínios", prazoDias: 1 },
  { id: "forn-distrib", name: "Distribuidora", whatsapp: "11940001003", categoria: "Bebidas", prazoDias: 2 },
  { id: "forn-atacado", name: "Atacado", whatsapp: "11940001004", categoria: "Secos", prazoDias: 4 },
  { id: "forn-naturais", name: "Naturais", whatsapp: "11940001005", categoria: "Bebidas", prazoDias: 5 },
  { id: "forn-feira", name: "Feira", whatsapp: "11940001006", categoria: "Hortifruti", prazoDias: 1 },
  { id: "forn-gelo", name: "Fábrica de gelo", whatsapp: "11940001007", categoria: "Bebidas", prazoDias: 1 },
  { id: "forn-confeitaria", name: "Confeitaria", whatsapp: "11940001008", categoria: "Confeitaria", prazoDias: 1 },
  { id: "forn-padaria", name: "Padaria Central", whatsapp: "11940001009", categoria: "Padaria", prazoDias: 1 },
  { id: "forn-acougue", name: "Açougue", whatsapp: "11940001010", categoria: "Frios", prazoDias: 2 }
];

export function findFornecedor(store, value) {
  const list = store.fornecedores || [];
  return list.find((item) => item.id === value || item.name === value) || null;
}

export function aplicarFornecedor(item, store, value) {
  const hit = findFornecedor(store, value);
  if (hit) {
    item.fornecedorId = hit.id;
    item.fornecedor = hit.name;
    item.supplier = hit.name;
    return hit;
  }
  item.fornecedorId = "";
  item.fornecedor = String(value || "");
  item.supplier = String(value || "");
  return null;
}

export function upsertFornecedor(store, payload = {}, id) {
  store.fornecedores = store.fornecedores || [];
  if (id) {
    const item = store.fornecedores.find((row) => row.id === id);
    if (!item) return null;
    if (payload.name != null) item.name = String(payload.name);
    if (payload.whatsapp != null) item.whatsapp = String(payload.whatsapp);
    if (payload.categoria != null) item.categoria = String(payload.categoria);
    if (payload.prazoDias !== undefined && payload.prazoDias !== "") item.prazoDias = Number(payload.prazoDias);
    return item;
  }
  const item = {
    id: uid("forn"),
    name: String(payload.name || "Fornecedor"),
    whatsapp: String(payload.whatsapp || ""),
    categoria: String(payload.categoria || "Geral"),
    prazoDias: Number(payload.prazoDias || 2)
  };
  store.fornecedores.unshift(item);
  return item;
}

export function produtosDoInsumo(products, insumoId) {
  return (products || []).filter((product) =>
    (product.fichaTecnica || product.recipe || []).some((row) => (row.insumo_id || row.ingredientId) === insumoId)
  );
}
