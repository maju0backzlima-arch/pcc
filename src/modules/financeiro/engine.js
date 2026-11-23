export const METODOS = ["pix", "credito", "debito", "voucher", "dinheiro"];
export const METODO_LABEL = {
  pix: "Pix",
  credito: "Crédito",
  debito: "Débito",
  voucher: "Voucher",
  dinheiro: "Dinheiro"
};

export const SETTLEMENT_DAYS = {
  pix: 1,
  debito: 1,
  voucher: 1,
  credito: 30,
  dinheiro: 0
};

export const CATEGORIAS = ["Fornecedores", "Aluguel", "Energia", "Folha", "Imposto DAS"];
export const CMV_ALERTA = 32;

export const defaultFinanceiro = {
  taxas: { pix: 0, credito: 3.49, debito: 1.99, voucher: 0, dinheiro: 0 },
  settlementDays: { ...SETTLEMENT_DAYS },
  impostoPercent: 6,
  regime: "simples_nacional",
  fundoCaixa: 200,
  cmvAlerta: CMV_ALERTA
};

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizarMetodo(value) {
  const raw = String(value || "pix")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (raw.includes("cred")) return "credito";
  if (raw.includes("deb")) return "debito";
  if (raw.includes("vouch") || raw.includes("vr") || raw.includes("sodexo") || raw.includes("alelo")) return "voucher";
  if (raw.includes("din")) return "dinheiro";
  return "pix";
}

export function taxaMaquininha(settings, metodo, valor) {
  const taxas = settings?.financeiro?.taxas || defaultFinanceiro.taxas;
  const pct = Number(taxas[metodo] ?? 0);
  return roundMoney((Number(valor) || 0) * pct / 100);
}

export function dataRecebimento(at, metodo, settings) {
  const days = Number(settings?.financeiro?.settlementDays?.[metodo] ?? SETTLEMENT_DAYS[metodo] ?? 0);
  const d = new Date(at || Date.now());
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function criarEntradaCaixa({ sale, metodo, settings }) {
  const mapped = normalizarMetodo(metodo);
  const bruto = roundMoney(sale.total);
  const taxa = taxaMaquininha(settings, mapped, bruto);
  const at = sale.at || new Date().toISOString();
  return {
    id: uid("cx"),
    at,
    tipo: "entrada",
    metodo: mapped,
    bruto,
    taxa,
    liquido: roundMoney(bruto - taxa),
    dataRecebimento: dataRecebimento(at, mapped, settings),
    settlementDays: Number(settings?.financeiro?.settlementDays?.[mapped] ?? SETTLEMENT_DAYS[mapped] ?? 0),
    origem: sale.source || "pdvplus",
    saleId: sale.id,
    notaId: sale.notaId || "",
    estornado: false,
    conferido: false,
    note: sale.note || ""
  };
}

export function estornarEntradaCaixa(store, saleId) {
  const entries = store.cashFlow || [];
  const hits = entries.filter((row) => row.saleId === saleId && !row.estornado && row.tipo === "entrada");
  const at = new Date().toISOString();
  for (const row of hits) {
    row.estornado = true;
    entries.unshift({
      id: uid("cx"),
      at,
      tipo: "saida",
      metodo: row.metodo,
      bruto: -row.bruto,
      taxa: -row.taxa,
      liquido: -row.liquido,
      dataRecebimento: at,
      origem: "estorno",
      saleId,
      notaId: row.notaId || "",
      estornado: false,
      conferido: false,
      note: `Estorno da venda ${saleId}`
    });
  }
  store.cashFlow = entries.slice(0, 800);
  return hits.length;
}

export function statusDespesa(despesa, now = new Date()) {
  if (despesa.status === "pago") return "pago";
  const due = despesa.dueDate ? new Date(despesa.dueDate) : null;
  if (due && !Number.isNaN(due.getTime()) && due < now) return "atrasado";
  return despesa.status || "pendente";
}

export function refreshDespesas(store) {
  const now = new Date();
  store.expenses = (store.expenses || []).map((item) => ({
    ...item,
    status: item.status === "pago" ? "pago" : statusDespesa(item, now)
  }));
  return store.expenses;
}

export function periodBounds(from, to) {
  const now = new Date();
  const start = from ? new Date(`${from}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to ? new Date(`${to}T23:59:59.999`) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export function monthBounds(ym) {
  if (!ym) return periodBounds();
  const [y, m] = String(ym).split("-").map(Number);
  const start = new Date(y, (m || 1) - 1, 1);
  const end = new Date(y, m || 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function inRange(iso, start, end) {
  if (!iso) return false;
  const d = new Date(iso);
  return d >= start && d <= end;
}

export function cmvProduto(product, ingredients = []) {
  const ficha = product.fichaTecnica || (product.recipe || []).map((row) => ({
    insumo_id: row.ingredientId || row.insumo_id,
    quantidade_usada: Number(row.qty ?? row.quantidade_usada ?? 0)
  }));
  const map = Object.fromEntries((ingredients || []).map((item) => [item.id, item]));
  const cmv = roundMoney(
    ficha.reduce((sum, row) => {
      const ing = map[row.insumo_id];
      const custo = Number(ing?.custo_unitario ?? ing?.costPerUnit ?? 0);
      return sum + custo * Number(row.quantidade_usada || 0);
    }, 0)
  );
  const preco = Number(product.preco_venda ?? product.price ?? 0);
  const percent = preco > 0 ? roundMoney((cmv / preco) * 100) : 0;
  return {
    cmv,
    percent,
    alerta: percent > Number(CMV_ALERTA)
  };
}

export function computeDre(store, from, to) {
  const { start, end } = from && from.length === 7 && !to ? monthBounds(from) : periodBounds(from, to);
  const sales = (store.sales || []).filter((sale) => !sale.estornada && inRange(sale.at, start, end));
  const cash = (store.cashFlow || []).filter((row) => !row.estornado && inRange(row.at, start, end));
  const faturamentoBruto = roundMoney(sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0));
  const taxasCartao = roundMoney(
    cash
      .filter((row) => row.tipo === "entrada" && ["credito", "debito", "voucher"].includes(row.metodo))
      .reduce((sum, row) => sum + (Number(row.taxa) || 0), 0)
  );
  const taxas = roundMoney(
    cash.filter((row) => row.tipo === "entrada").reduce((sum, row) => sum + (Number(row.taxa) || 0), 0)
  );
  const cmvTotal = roundMoney(
    sales.reduce((sum, sale) => {
      return (
        sum +
        (sale.items || []).reduce((acc, item) => acc + (Number(item.custo ?? item.cost ?? 0) * Number(item.qty || 0)), 0)
      );
    }, 0)
  );
  const impostoPercent = Number(store.settings?.financeiro?.impostoPercent ?? defaultFinanceiro.impostoPercent);
  const impostoDas = roundMoney(faturamentoBruto * (impostoPercent / 100));
  const despesasPeriodo = refreshDespesas(store).filter((item) => inRange(item.dueDate, start, end));
  const despesasFixas = roundMoney(
    despesasPeriodo.filter((item) => item.type === "fixa").reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  );
  const despesasVariaveis = roundMoney(
    despesasPeriodo.filter((item) => item.type === "variavel").reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  );
  const perdas = roundMoney(
    (store.perdas || []).filter((row) => inRange(row.at, start, end)).reduce((sum, row) => sum + (Number(row.custo) || 0), 0)
  );
  const lucroBruto = roundMoney(faturamentoBruto - impostoDas - taxasCartao - cmvTotal);
  const lucroLiquidoReal = roundMoney(lucroBruto - despesasFixas - despesasVariaveis - perdas);
  const recebiveis = (store.receivables || []).filter((item) => inRange(item.dueDate, start, end));
  const aReceber = roundMoney(recebiveis.filter((item) => item.status !== "pago").reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
  const recebido = roundMoney(recebiveis.filter((item) => item.status === "pago").reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
  const saldoCaixa = roundMoney(cash.reduce((sum, row) => sum + (Number(row.liquido) || 0), 0));
  const ticketMedio = sales.length ? roundMoney(faturamentoBruto / sales.length) : 0;

  const porMetodo = {};
  for (const metodo of METODOS) {
    const rows = cash.filter((row) => row.metodo === metodo && row.tipo === "entrada");
    porMetodo[metodo] = {
      qtd: rows.length,
      bruto: roundMoney(rows.reduce((sum, row) => sum + (Number(row.bruto) || 0), 0)),
      taxa: roundMoney(rows.reduce((sum, row) => sum + (Number(row.taxa) || 0), 0)),
      liquido: roundMoney(rows.reduce((sum, row) => sum + (Number(row.liquido) || 0), 0)),
      aReceber: roundMoney(
        rows
          .filter((row) => new Date(row.dataRecebimento || row.at) > new Date())
          .reduce((sum, row) => sum + (Number(row.liquido) || 0), 0)
      )
    };
  }

  const porCategoria = {};
  for (const cat of CATEGORIAS) {
    porCategoria[cat] = roundMoney(
      despesasPeriodo.filter((item) => item.category === cat).reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
    );
  }

  return {
    from: start.toISOString(),
    to: end.toISOString(),
    faturamentoBruto,
    impostoDas,
    impostoPercent,
    taxasCartao,
    taxas,
    cmv: cmvTotal,
    cmvTotal,
    lucroBruto,
    despesasFixas,
    despesasVariaveis,
    perdas,
    lucroLiquido: lucroLiquidoReal,
    lucroLiquidoReal,
    impostos: impostoDas,
    vendas: sales.length,
    ticketMedio,
    aReceber,
    recebido,
    saldoCaixa,
    porMetodo,
    porCategoria
  };
}

export function resumoCaixaDia(store, date) {
  const day = date || new Date().toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(`${day}T23:59:59.999`);
  const sales = (store.sales || []).filter((sale) => !sale.estornada && inRange(sale.at, start, end));
  const cash = (store.cashFlow || []).filter((row) => !row.estornado && inRange(row.at, start, end));
  const porMetodo = {};
  for (const metodo of METODOS) {
    const rows = cash.filter((row) => row.metodo === metodo && row.tipo === "entrada");
    porMetodo[metodo] = roundMoney(rows.reduce((sum, row) => sum + (Number(row.bruto) || 0), 0));
  }
  const sangrias = cash.filter((row) => row.origem === "manual" && String(row.note || "").startsWith("Sangria"));
  const suprimentos = cash.filter((row) => row.origem === "manual" && String(row.note || "").startsWith("Suprimento"));
  const sistema = roundMoney(Object.values(porMetodo).reduce((sum, v) => sum + v, 0));
  return {
    date: day,
    vendas: sales.length,
    porMetodo,
    sistema,
    dinheiroSistema: porMetodo.dinheiro,
    sangria: roundMoney(sangrias.reduce((sum, row) => sum + Math.abs(Number(row.bruto) || 0), 0)),
    suprimento: roundMoney(suprimentos.reduce((sum, row) => sum + Math.abs(Number(row.bruto) || 0), 0)),
    fundoCaixa: Number(store.settings?.financeiro?.fundoCaixa || 200)
  };
}

export function conferirFechamento(store, payload = {}) {
  const day = payload.date || new Date().toISOString().slice(0, 10);
  const resumo = resumoCaixaDia(store, day);
  const gaveta = payload.gaveta || {};
  const diferencas = {};
  let totalGaveta = 0;
  let totalDiff = 0;
  for (const metodo of METODOS) {
    const sistema = Number(resumo.porMetodo[metodo] || 0);
    const informado = Number(gaveta[metodo] ?? sistema);
    const diff = roundMoney(informado - sistema);
    diferencas[metodo] = { sistema, gaveta: informado, diferenca: diff };
    totalGaveta = roundMoney(totalGaveta + informado);
    totalDiff = roundMoney(totalDiff + diff);
  }
  const fechamento = {
    id: uid("close"),
    at: new Date().toISOString(),
    date: day,
    operador: payload.operador || "",
    resumo,
    diferencas,
    totalSistema: resumo.sistema,
    totalGaveta,
    diferenca: totalDiff,
    ok: Math.abs(totalDiff) < 0.01,
    note: payload.note || ""
  };
  store.fechamentos = store.fechamentos || [];
  store.fechamentos.unshift(fechamento);
  return fechamento;
}

export function upsertDespesa(store, payload, id) {
  const now = new Date().toISOString();
  const category = CATEGORIAS.includes(payload.category) ? payload.category : (payload.category || "Fornecedores");
  if (id) {
    const item = (store.expenses || []).find((row) => row.id === id);
    if (!item) return null;
    if (payload.name != null) item.name = String(payload.name);
    if (payload.type) item.type = payload.type === "variavel" ? "variavel" : "fixa";
    if (payload.amount !== undefined && payload.amount !== "") item.amount = Number(payload.amount);
    if (payload.dueDate) item.dueDate = String(payload.dueDate);
    if (payload.category != null) item.category = category;
    if (payload.notes != null) item.notes = String(payload.notes);
    if (payload.status) item.status = payload.status;
    item.updatedAt = now;
    item.status = statusDespesa(item);
    return item;
  }
  const item = {
    id: uid("desp"),
    name: String(payload.name || "Despesa"),
    type: payload.type === "variavel" ? "variavel" : "fixa",
    amount: Number(payload.amount || 0),
    dueDate: String(payload.dueDate || now.slice(0, 10)),
    category,
    notes: String(payload.notes || ""),
    status: "pendente",
    paidAt: null,
    createdAt: now,
    updatedAt: now
  };
  item.status = statusDespesa(item);
  store.expenses = store.expenses || [];
  store.expenses.unshift(item);
  return item;
}

export function pagarDespesa(store, id) {
  const item = (store.expenses || []).find((row) => row.id === id);
  if (!item) return null;
  item.status = "pago";
  item.paidAt = new Date().toISOString();
  item.updatedAt = item.paidAt;
  store.cashFlow = store.cashFlow || [];
  store.cashFlow.unshift({
    id: uid("cx"),
    at: item.paidAt,
    tipo: "saida",
    metodo: "dinheiro",
    bruto: -Number(item.amount || 0),
    taxa: 0,
    liquido: -Number(item.amount || 0),
    dataRecebimento: item.paidAt,
    origem: "despesa",
    saleId: "",
    notaId: "",
    estornado: false,
    conferido: true,
    note: item.name,
    expenseId: item.id
  });
  return item;
}

export function lancarManual(store, payload = {}) {
  const at = payload.at || new Date().toISOString();
  const tipo = payload.tipo === "saida" ? "saida" : "entrada";
  const metodo = normalizarMetodo(payload.metodo || "dinheiro");
  const bruto = roundMoney(Number(payload.amount || 0) * (tipo === "saida" ? -1 : 1));
  const row = {
    id: uid("cx"),
    at,
    tipo,
    metodo,
    bruto,
    taxa: 0,
    liquido: bruto,
    dataRecebimento: at,
    origem: "manual",
    saleId: "",
    notaId: "",
    estornado: false,
    conferido: false,
    note: String(payload.note || payload.name || "Lançamento manual")
  };
  store.cashFlow = store.cashFlow || [];
  store.cashFlow.unshift(row);
  return row;
}

export function upsertReceivable(store, payload = {}, id) {
  const now = new Date().toISOString();
  if (id) {
    const item = (store.receivables || []).find((row) => row.id === id);
    if (!item) return null;
    if (payload.name != null) item.name = String(payload.name);
    if (payload.amount !== undefined) item.amount = Number(payload.amount);
    if (payload.dueDate) item.dueDate = String(payload.dueDate);
    if (payload.status) item.status = payload.status;
    item.updatedAt = now;
    return item;
  }
  const item = {
    id: uid("rec"),
    name: String(payload.name || "A receber"),
    amount: Number(payload.amount || 0),
    dueDate: String(payload.dueDate || now.slice(0, 10)),
    status: "pendente",
    notes: String(payload.notes || ""),
    createdAt: now,
    updatedAt: now
  };
  store.receivables = store.receivables || [];
  store.receivables.unshift(item);
  return item;
}

export function receberConta(store, id) {
  const item = (store.receivables || []).find((row) => row.id === id);
  if (!item) return null;
  item.status = "pago";
  item.paidAt = new Date().toISOString();
  store.cashFlow = store.cashFlow || [];
  store.cashFlow.unshift({
    id: uid("cx"),
    at: item.paidAt,
    tipo: "entrada",
    metodo: "pix",
    bruto: Number(item.amount || 0),
    taxa: 0,
    liquido: Number(item.amount || 0),
    dataRecebimento: item.paidAt,
    origem: "receber",
    saleId: "",
    notaId: "",
    estornado: false,
    conferido: true,
    note: item.name,
    receivableId: item.id
  });
  return item;
}

export function sangriaSuprimento(store, payload = {}) {
  const tipo = payload.tipo === "suprimento" ? "entrada" : "saida";
  return lancarManual(store, {
    tipo,
    metodo: "dinheiro",
    amount: payload.amount,
    note: payload.tipo === "suprimento" ? `Suprimento: ${payload.note || ""}` : `Sangria: ${payload.note || ""}`
  });
}

export function defaultExpenses() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const now = new Date().toISOString();
  return [
    { id: "desp-aluguel", name: "Aluguel do ponto", type: "fixa", amount: 2500, dueDate: `${y}-${m}-05`, category: "Aluguel", notes: "", status: "pendente", paidAt: null, createdAt: now, updatedAt: now },
    { id: "desp-energia", name: "Energia", type: "fixa", amount: 380, dueDate: `${y}-${m}-10`, category: "Energia", notes: "", status: "pendente", paidAt: null, createdAt: now, updatedAt: now },
    { id: "desp-folha", name: "Folha da equipe", type: "fixa", amount: 3200, dueDate: `${y}-${m}-05`, category: "Folha", notes: "", status: "pendente", paidAt: null, createdAt: now, updatedAt: now },
    { id: "desp-das", name: "DAS Simples Nacional", type: "fixa", amount: 420, dueDate: `${y}-${m}-20`, category: "Imposto DAS", notes: "", status: "pendente", paidAt: null, createdAt: now, updatedAt: now },
    { id: "desp-forn", name: "Compra de insumos", type: "variavel", amount: 890, dueDate: `${y}-${m}-12`, category: "Fornecedores", notes: "", status: "pendente", paidAt: null, createdAt: now, updatedAt: now }
  ];
}
