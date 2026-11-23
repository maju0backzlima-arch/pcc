import { normalizarMetodo } from "../financeiro/engine.js";
import { aplicarFornecedor } from "./fornecedores.js";

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const REVENDA_IDS = new Set([
  "prd-refri",
  "prd-agua-sem",
  "prd-agua-com",
  "prd-acresc-bacon",
  "prd-acresc-presunto",
  "prd-acresc-mussarela",
  "prd-acresc-ovo",
  "prd-leite-zero",
  "prd-pao-sg",
  "prd-bolo-sg"
]);

export function normalizeInsumo(item) {
  return {
    ...item,
    id: item.id,
    nome: item.nome || item.name || "",
    name: item.name || item.nome || "",
    unidade: item.unidade || item.unit || "un",
    unit: item.unit || item.unidade || "un",
    custo_unitario: Number(item.custo_unitario ?? item.costPerUnit ?? 0),
    costPerUnit: Number(item.custo_unitario ?? item.costPerUnit ?? 0),
    estoque_atual: Number(item.estoque_atual ?? item.stock ?? 0),
    stock: Number(item.estoque_atual ?? item.stock ?? 0),
    estoque_minimo: Number(item.estoque_minimo ?? item.minStock ?? 0),
    minStock: Number(item.estoque_minimo ?? item.minStock ?? 0),
    estoque_ideal: Number(item.estoque_ideal ?? item.targetStock ?? 0),
    targetStock: Number(item.estoque_ideal ?? item.targetStock ?? 0),
    validade: item.validade || item.expiry || "",
    fornecedor: item.fornecedor || item.supplier || "Sem fornecedor",
    supplier: item.supplier || item.fornecedor || "Sem fornecedor",
    fornecedorId: item.fornecedorId || "",
    active: item.active !== false
  };
}

export function aplicarPatchInsumo(item, body = {}, store) {
  if (body.name != null || body.nome != null) {
    item.name = String(body.name || body.nome);
    item.nome = item.name;
  }
  if (body.unit != null || body.unidade != null) {
    item.unit = String(body.unit || body.unidade);
    item.unidade = item.unit;
  }
  if (body.category != null) item.category = String(body.category);
  if (body.validade != null) item.validade = String(body.validade);
  if (body.active != null) item.active = Boolean(body.active);
  const nums = [
    ["stock", "estoque_atual"],
    ["minStock", "estoque_minimo"],
    ["targetStock", "estoque_ideal"],
    ["costPerUnit", "custo_unitario"]
  ];
  for (const [en, pt] of nums) {
    const raw = body[en] !== undefined && body[en] !== "" ? body[en] : body[pt];
    if (raw !== undefined && raw !== "") {
      const value = Number(raw);
      if (!Number.isNaN(value) && value >= 0) {
        item[en] = value;
        item[pt] = value;
      }
    }
  }
  if (body.fornecedor != null || body.fornecedorId != null || body.supplier != null) {
    aplicarFornecedor(item, store, body.fornecedorId || body.fornecedor || body.supplier);
  }
  return item;
}

export function tipoProduto(product) {
  if (product.tipo === "revenda" || product.tipo === "preparo") return product.tipo;
  return REVENDA_IDS.has(product.id) ? "revenda" : "preparo";
}

export function fiscalDefaults(product) {
  const tipo = tipoProduto(product);
  return {
    ncm: product.ncm || (tipo === "revenda" ? "22021000" : "21011110"),
    cfop: product.cfop || "5102",
    csosn: product.csosn || (tipo === "revenda" ? "500" : "102")
  };
}

export function normalizeProdutoVenda(product) {
  const tipo = tipoProduto(product);
  const fiscal = fiscalDefaults(product);
  const ficha = Array.isArray(product.fichaTecnica)
    ? product.fichaTecnica
    : (product.recipe || []).map((row) => ({
        insumo_id: row.ingredientId || row.insumo_id,
        quantidade_usada: Number(row.qty ?? row.quantidade_usada ?? 0)
      }));
  return {
    ...product,
    nome: product.nome || product.name || "",
    name: product.name || product.nome || "",
    preco_venda: Number(product.preco_venda ?? product.price ?? 0),
    price: Number(product.preco_venda ?? product.price ?? 0),
    tipo,
    ncm: fiscal.ncm,
    cfop: fiscal.cfop,
    csosn: fiscal.csosn,
    fichaTecnica: ficha,
    recipe: ficha.map((row) => ({ ingredientId: row.insumo_id, qty: row.quantidade_usada }))
  };
}

export function aplicarPatchProduto(product, body = {}) {
  if (body.nome != null || body.name != null) {
    product.nome = String(body.nome || body.name);
    product.name = product.nome;
  }
  if (body.sku != null) product.sku = String(body.sku);
  if (body.category != null) product.category = String(body.category);
  if (body.tipo) product.tipo = body.tipo === "revenda" ? "revenda" : "preparo";
  if (body.ncm != null) product.ncm = String(body.ncm);
  if (body.cfop != null) product.cfop = String(body.cfop);
  if (body.csosn != null) product.csosn = String(body.csosn);
  if (body.active != null) product.active = Boolean(body.active);
  if (body.preco_custo !== undefined && body.preco_custo !== "") product.preco_custo = Number(body.preco_custo);
  const priceRaw = body.preco_venda !== undefined && body.preco_venda !== "" ? body.preco_venda : body.price;
  if (priceRaw !== undefined && priceRaw !== "") {
    const price = Number(priceRaw);
    product.preco_venda = price;
    product.price = price;
    product.priceOverride = price;
  }
  const stockRaw = body.estoque_atual !== undefined && body.estoque_atual !== "" ? body.estoque_atual : body.stock;
  if (stockRaw !== undefined && stockRaw !== "") {
    const stock = Number(stockRaw);
    product.estoque_atual = stock;
    product.stockOverride = stock;
  }
  if (body.estoque_minimo !== undefined && body.estoque_minimo !== "") product.estoque_minimo = Number(body.estoque_minimo);
  if (body.estoque_ideal !== undefined && body.estoque_ideal !== "") product.estoque_ideal = Number(body.estoque_ideal);
  if (body.fornecedor != null) product.fornecedor = String(body.fornecedor);
  if (Array.isArray(body.fichaTecnica) || Array.isArray(body.recipe)) {
    const ficha = Array.isArray(body.fichaTecnica)
      ? body.fichaTecnica
      : body.recipe.map((row) => ({
          insumo_id: row.ingredientId || row.insumo_id,
          quantidade_usada: Number(row.qty ?? row.quantidade_usada ?? 0)
        }));
    product.fichaTecnica = ficha;
    product.recipe = ficha.map((row) => ({ ingredientId: row.insumo_id, qty: row.quantidade_usada }));
  }
  if (body.clearPrice) product.priceOverride = null;
  if (body.clearStock) product.stockOverride = null;
  return product;
}

export function cloneInsumo(item) {
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = uid("ing");
  const base = String(item.nome || item.name || "Insumo").replace(/ \(Cópia\)$/, "");
  copy.name = `${base} (Cópia)`;
  copy.nome = copy.name;
  copy.active = true;
  return copy;
}

export function cloneProduto(product) {
  const src = normalizeProdutoVenda(product);
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid("prd");
  const base = String(src.nome || src.name || "Produto").replace(/ \(Cópia\)$/, "");
  copy.name = `${base} (Cópia)`;
  copy.nome = copy.name;
  copy.sku = `${String(src.sku || "SKU").slice(0, 16)}-C`;
  copy.origin = "manual";
  copy.active = true;
  return copy;
}

export function vencendoEm(item, days = 3) {
  const raw = item.validade;
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const lim = new Date(now);
  lim.setDate(lim.getDate() + days);
  return d >= now && d <= lim;
}

export function waDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length <= 11 ? `55${digits}` : digits;
}

export function listaWhatsappGrupo(grupo) {
  const linhas = [`*PIC NIC — pedido ${grupo.fornecedor}*`, `_${new Date().toLocaleString("pt-BR")}_`, ""];
  for (const item of grupo.itens || []) {
    linhas.push(`• ${item.quantidade_comprar} ${item.unidade} ${item.nome}`);
  }
  linhas.push("");
  linhas.push(`Total estimado: ${Number(grupo.total || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
  return linhas.join("\n");
}

export function processarVendaPDV(store, venda = {}) {
  const at = venda.at || new Date().toISOString();
  const items = Array.isArray(venda.items) ? venda.items : [];
  const consumed = [];
  const saleItems = [];
  for (const line of items) {
    const product = (store.products || []).find(
      (item) =>
        item.id === line.productId ||
        item.id === line.id ||
        item.sku === line.sku ||
        item.name === (line.name || line.nome)
    );
    const qty = Number(line.qty ?? line.quantidade ?? 1);
    if (!product || qty <= 0) continue;
    const prod = normalizeProdutoVenda(product);
    const unitPrice = Number(prod.preco_venda || product.price || 0);
    const unitCost = Number(product.preco_custo ?? 0);
    if (prod.tipo === "revenda") {
      const insumoId = prod.fichaTecnica[0]?.insumo_id;
      const insumo = insumoId ? store.ingredients.find((row) => row.id === insumoId) : null;
      if (insumo) {
        const used = roundQty(qty * (prod.fichaTecnica[0]?.quantidade_usada || 1));
        baixarInsumo(insumo, used);
        consumed.push({ ingredientId: insumo.id, name: insumo.name, unit: insumo.unit, qty: used, stockAfter: insumo.stock });
        store.movements.unshift({
          id: uid("mov"),
          at,
          type: "sale",
          ingredientId: insumo.id,
          qty: -used,
          note: `${prod.nome} x${qty}`
        });
      }
      product.estoque_atual = roundQty(Math.max(0, Number(product.estoque_atual || 0) - qty));
    } else {
      for (const row of prod.fichaTecnica) {
        const insumo = store.ingredients.find((item) => item.id === row.insumo_id);
        if (!insumo) continue;
        const used = roundQty(Number(row.quantidade_usada || 0) * qty);
        baixarInsumo(insumo, used);
        consumed.push({ ingredientId: insumo.id, name: insumo.name, unit: insumo.unit, qty: used, stockAfter: insumo.stock });
        store.movements.unshift({
          id: uid("mov"),
          at,
          type: "sale",
          ingredientId: insumo.id,
          qty: -used,
          note: `${prod.nome} x${qty}`
        });
      }
      product.estoque_atual = roundQty(Math.max(0, Number(product.estoque_atual || 0) - qty));
    }
    saleItems.push({
      productId: product.id,
      sku: product.sku,
      name: prod.nome,
      qty,
      price: unitPrice,
      custo: unitCost,
      cost: unitCost,
      tipo: prod.tipo,
      ncm: prod.ncm,
      cfop: prod.cfop,
      csosn: prod.csosn,
      total: roundMoney(unitPrice * qty)
    });
  }
  if (!saleItems.length) return null;
  return {
    id: venda.id || uid("sale"),
    at,
    source: venda.source || "pdvplus",
    paymentMethod: normalizarMetodo(venda.paymentMethod || venda.metodo || "pix"),
    note: venda.note || "",
    items: saleItems,
    consumed,
    total: roundMoney(saleItems.reduce((sum, item) => sum + item.total, 0)),
    estornada: false
  };
}

export function baixarInsumo(insumo, qty) {
  const used = roundQty(qty);
  insumo.stock = roundQty(Math.max(0, Number(insumo.stock || 0) - used));
  insumo.estoque_atual = insumo.stock;
  return used;
}

export function registrarPerda(store, payload = {}) {
  const insumo = store.ingredients.find((item) => item.id === payload.insumoId || item.id === payload.ingredientId);
  if (!insumo) return null;
  const qty = roundQty(payload.qty || payload.quantidade || 0);
  if (qty <= 0) return null;
  baixarInsumo(insumo, qty);
  const at = new Date().toISOString();
  const perda = {
    id: uid("perda"),
    at,
    insumoId: insumo.id,
    nome: insumo.name,
    unidade: insumo.unit,
    qty,
    motivo: String(payload.motivo || payload.reason || "Quebra"),
    custo: roundMoney(qty * Number(insumo.costPerUnit || 0)),
    operador: payload.operador || ""
  };
  store.perdas = store.perdas || [];
  store.perdas.unshift(perda);
  store.movements.unshift({
    id: uid("mov"),
    at,
    type: "perda",
    ingredientId: insumo.id,
    qty: -qty,
    note: perda.motivo
  });
  return perda;
}

export function parseXmlNfe(xml = "") {
  const text = String(xml || "");
  const tag = (name) => {
    const match = text.match(new RegExp(`<${name}[^>]*>([^<]+)</${name}>`, "i"));
    return match ? match[1].trim() : "";
  };
  const itens = [];
  const blocks = text.split(/<det[\s>]/i).slice(1);
  for (const block of blocks) {
    const nome = (block.match(/<xProd[^>]*>([^<]+)<\/xProd>/i) || [])[1] || "";
    const qtd = Number((block.match(/<qCom[^>]*>([^<]+)<\/qCom>/i) || [])[1] || 0);
    const vUn = Number((block.match(/<vUnCom[^>]*>([^<]+)<\/vUnCom>/i) || [])[1] || 0);
    const unidade = (block.match(/<uCom[^>]*>([^<]+)<\/uCom>/i) || [])[1] || "un";
    if (nome && qtd) itens.push({ nome, qty: qtd, custo: vUn, unidade, ncm: (block.match(/<NCM[^>]*>([^<]+)<\/NCM>/i) || [])[1] || "" });
  }
  if (!itens.length) {
    const mock = [
      { nome: "Leite", qty: 12000, custo: 0.0055, unidade: "ml", ncm: "04012010" },
      { nome: "Café", qty: 2000, custo: 0.085, unidade: "g", ncm: "09012100" },
      { nome: "Pão caseiro", qty: 40, custo: 2.4, unidade: "un", ncm: "19059090" }
    ];
    return {
      mock: true,
      chave: tag("chNFe") || "35241100000000000000000000000000000000000000",
      emitente: tag("xNome") || "Atacado Café LTDA",
      numero: tag("nNF") || "1842",
      itens: mock
    };
  }
  return {
    mock: false,
    chave: tag("chNFe"),
    emitente: tag("xNome"),
    numero: tag("nNF"),
    itens
  };
}

export function entradaCompra(store, payload = {}) {
  const at = new Date().toISOString();
  const itens = Array.isArray(payload.itens) ? payload.itens : [];
  const aplicados = [];
  for (const line of itens) {
    const insumo = store.ingredients.find(
      (item) =>
        item.id === line.insumoId ||
        String(item.name).toLowerCase() === String(line.nome || "").toLowerCase()
    );
    if (!insumo) continue;
    const qty = roundQty(line.qty || line.quantidade || 0);
    if (qty <= 0) continue;
    const custoNovo = Number(line.custo ?? line.custo_unitario ?? insumo.costPerUnit ?? 0);
    const estoqueAntes = Number(insumo.stock || 0);
    const custoMedio = estoqueAntes + qty > 0
      ? roundMoney((estoqueAntes * Number(insumo.costPerUnit || 0) + qty * custoNovo) / (estoqueAntes + qty))
      : custoNovo;
    insumo.stock = roundQty(estoqueAntes + qty);
    insumo.estoque_atual = insumo.stock;
    insumo.costPerUnit = custoMedio;
    insumo.custo_unitario = custoMedio;
    if (line.validade) insumo.validade = line.validade;
    aplicados.push({
      insumoId: insumo.id,
      nome: insumo.name,
      qty,
      custoAnterior: Number(line.custoAnterior || 0),
      custoMedio,
      unidade: insumo.unit
    });
    store.movements.unshift({
      id: uid("mov"),
      at,
      type: "compra",
      ingredientId: insumo.id,
      qty,
      note: payload.numero ? `NF-e ${payload.numero}` : "Entrada de compra"
    });
  }
  const compra = {
    id: uid("nfe"),
    at,
    chave: payload.chave || "",
    emitente: payload.emitente || "",
    numero: payload.numero || "",
    mock: Boolean(payload.mock),
    itens: aplicados,
    total: roundMoney(aplicados.reduce((sum, item) => sum + item.qty * item.custoMedio, 0))
  };
  store.comprasNfe = store.comprasNfe || [];
  store.comprasNfe.unshift(compra);
  store.purchases.unshift({
    id: compra.id,
    at,
    name: compra.emitente || "Compra NF-e",
    qty: aplicados.reduce((sum, item) => sum + item.qty, 0),
    unit: "un",
    cost: compra.total,
    supplier: compra.emitente
  });
  return compra;
}

export function gerarListaComprasInsumos(insumos = []) {
  const itens = insumos
    .filter((item) => item.active !== false)
    .map(normalizeInsumo)
    .filter((item) => Number(item.estoque_atual) <= Number(item.estoque_minimo))
    .map((item) => {
      const quantidade_comprar = roundQty(Math.max(0, Number(item.estoque_ideal) - Number(item.estoque_atual)));
      return {
        id: item.id,
        nome: item.nome,
        unidade: item.unidade,
        estoque_atual: item.estoque_atual,
        estoque_minimo: item.estoque_minimo,
        estoque_ideal: item.estoque_ideal,
        quantidade_comprar,
        custo_unitario: item.custo_unitario,
        estimado: roundMoney(quantidade_comprar * item.custo_unitario),
        fornecedor: item.fornecedor,
        fornecedorId: item.fornecedorId || "",
        validade: item.validade
      };
    })
    .filter((item) => item.quantidade_comprar > 0);

  const map = new Map();
  for (const item of itens) {
    if (!map.has(item.fornecedor)) map.set(item.fornecedor, { fornecedor: item.fornecedor, itens: [], total: 0 });
    const grupo = map.get(item.fornecedor);
    grupo.itens.push(item);
    grupo.total = roundMoney(grupo.total + item.estimado);
  }
  return {
    geradoEm: new Date().toISOString(),
    totalItens: itens.length,
    estimado: roundMoney(itens.reduce((sum, item) => sum + item.estimado, 0)),
    itens,
    grupos: Array.from(map.values())
  };
}

export function listaWhatsapp(lista) {
  const linhas = ["*PIC NIC — lista de compras*", `_${new Date(lista.geradoEm).toLocaleString("pt-BR")}_`, ""];
  for (const grupo of lista.grupos || []) {
    linhas.push(`*${grupo.fornecedor}*`);
    for (const item of grupo.itens) {
      linhas.push(`• ${item.quantidade_comprar} ${item.unidade} ${item.nome}`);
    }
    linhas.push("");
  }
  linhas.push(`Total estimado: ${Number(lista.estimado || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
  return linhas.join("\n");
}

export { roundQty, roundMoney, uid };
