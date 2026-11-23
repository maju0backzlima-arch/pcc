function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeProduto(product) {
  const nome = product.nome || product.name || "";
  const preco_venda = Number(product.preco_venda ?? product.price ?? 0);
  const preco_custo = Number(product.preco_custo ?? product.cost ?? 0);
  const estoque_atual = Number(product.estoque_atual ?? product.stockOverride ?? product.lastPdvStock ?? 0);
  const estoque_minimo = Number(product.estoque_minimo ?? 4);
  const estoque_ideal = Number(product.estoque_ideal ?? Math.max(estoque_minimo * 3, 12));
  return {
    ...product,
    nome,
    name: product.name || nome,
    sku: product.sku || "",
    preco_custo,
    preco_venda,
    price: product.price ?? preco_venda,
    estoque_atual,
    estoque_minimo,
    estoque_ideal,
    fornecedor: product.fornecedor || "Sem fornecedor"
  };
}

export function baixarEstoqueProduto(product, qty) {
  const used = roundQty(qty);
  product.estoque_atual = roundQty(Math.max(0, Number(product.estoque_atual || 0) - used));
  if (product.stockOverride != null) product.stockOverride = product.estoque_atual;
  return used;
}

export function devolverEstoqueProduto(product, qty) {
  const back = roundQty(qty);
  product.estoque_atual = roundQty(Number(product.estoque_atual || 0) + back);
  if (product.stockOverride != null) product.stockOverride = product.estoque_atual;
  return back;
}

export function gerarListaCompras(produtos = []) {
  const itens = produtos
    .filter((p) => p.active !== false)
    .map(normalizeProduto)
    .filter((p) => Number(p.estoque_atual ?? p.available ?? 0) <= Number(p.estoque_minimo ?? 4))
    .map((p) => {
      const quantidade_comprar = roundQty(Math.max(0, Number(p.estoque_ideal) - Number(p.estoque_atual)));
      return {
        id: p.id,
        nome: p.nome || p.name,
        sku: p.sku,
        estoque_atual: Number(p.estoque_atual) || 0,
        estoque_minimo: Number(p.estoque_minimo) || 0,
        estoque_ideal: Number(p.estoque_ideal) || 0,
        quantidade_comprar,
        preco_custo: Number(p.preco_custo) || 0,
        estimado: roundMoney(quantidade_comprar * (Number(p.preco_custo) || 0)),
        fornecedor: p.fornecedor || "Sem fornecedor"
      };
    })
    .filter((item) => item.quantidade_comprar > 0)
    .sort((a, b) => a.fornecedor.localeCompare(b.fornecedor, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));

  const map = new Map();
  for (const item of itens) {
    const key = item.fornecedor;
    if (!map.has(key)) map.set(key, { fornecedor: key, itens: [], total: 0, quantidade: 0 });
    const grupo = map.get(key);
    grupo.itens.push(item);
    grupo.total = roundMoney(grupo.total + item.estimado);
    grupo.quantidade += item.quantidade_comprar;
  }

  return {
    geradoEm: new Date().toISOString(),
    totalItens: itens.length,
    estimado: roundMoney(itens.reduce((sum, item) => sum + item.estimado, 0)),
    itens,
    grupos: Array.from(map.values())
  };
}

export function registrarSaidaHistorico(store, { product, qty, saleId, at, note }) {
  store.movements = store.movements || [];
  store.movements.unshift({
    id: uid("mov"),
    at,
    type: "sale_product",
    productId: product.id,
    sku: product.sku,
    name: product.nome || product.name,
    qty: -roundQty(qty),
    stockAfter: product.estoque_atual,
    saleId: saleId || "",
    note: note || `${product.nome || product.name} x${qty}`
  });
  store.movements = store.movements.slice(0, 800);
}

export function listaComprasTexto(lista) {
  const linhas = [`Lista de compras PIC NIC`, `Gerada em ${new Date(lista.geradoEm).toLocaleString("pt-BR")}`, ""];
  for (const grupo of lista.grupos || []) {
    linhas.push(`*${grupo.fornecedor}*`);
    for (const item of grupo.itens) {
      linhas.push(`- ${item.quantidade_comprar}x ${item.nome} (${item.sku})`);
    }
    linhas.push(`Subtotal: ${grupo.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`, "");
  }
  linhas.push(`Total estimado: ${Number(lista.estimado || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
  return linhas.join("\n");
}

export function listaComprasCsv(lista) {
  const rows = [["Fornecedor", "Produto", "SKU", "Estoque atual", "Mínimo", "Ideal", "Qtd comprar", "Custo unit", "Estimado"]];
  for (const grupo of lista.grupos || []) {
    for (const item of grupo.itens) {
      rows.push([
        grupo.fornecedor,
        item.nome,
        item.sku,
        item.estoque_atual,
        item.estoque_minimo,
        item.estoque_ideal,
        item.quantidade_comprar,
        item.preco_custo,
        item.estimado
      ]);
    }
  }
  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
}
