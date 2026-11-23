export const METODOS = ["pix", "credito", "debito", "dinheiro"];
export const METODO_LABEL = {
  pix: "Pix",
  credito: "Crédito",
  debito: "Débito",
  dinheiro: "Dinheiro"
};

export const defaultFinanceiro = {
  taxas: { pix: 0, credito: 3.49, debito: 1.99, dinheiro: 0 },
  impostoPercent: 6
};

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function taxaMaquininha(settings, metodo, valor) {
  const taxas = settings?.financeiro?.taxas || defaultFinanceiro.taxas;
  const pct = Number(taxas[metodo] ?? 0);
  return roundMoney((Number(valor) || 0) * pct / 100);
}

export function criarEntradaCaixa({ sale, metodo, settings }) {
  const bruto = roundMoney(sale.total);
  const taxa = taxaMaquininha(settings, metodo, bruto);
  return {
    id: uid("cx"),
    at: sale.at,
    tipo: "entrada",
    metodo,
    bruto,
    taxa,
    liquido: roundMoney(bruto - taxa),
    origem: sale.source || "pdvplus",
    saleId: sale.id,
    notaId: sale.notaId || "",
    estornado: false,
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
      origem: "estorno",
      saleId,
      notaId: row.notaId || "",
      estornado: false,
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

function inRange(iso, start, end) {
  if (!iso) return false;
  const d = new Date(iso);
  return d >= start && d <= end;
}

export function computeDre(store, from, to) {
  const { start, end } = periodBounds(from, to);
  const sales = (store.sales || []).filter((sale) => !sale.estornada && inRange(sale.at, start, end));
  const cash = (store.cashFlow || []).filter((row) => !row.estornado && inRange(row.at, start, end));
  const faturamentoBruto = roundMoney(sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0));
  const taxas = roundMoney(
    cash.filter((row) => row.tipo === "entrada").reduce((sum, row) => sum + (Number(row.taxa) || 0), 0)
  );
  const cmv = roundMoney(
    sales.reduce((sum, sale) => {
      const lines = sale.items || [];
      return (
        sum +
        lines.reduce((acc, item) => acc + (Number(item.custo ?? item.cost ?? 0) * Number(item.qty || 0)), 0)
      );
    }, 0)
  );
  const impostoPercent = Number(store.settings?.financeiro?.impostoPercent ?? defaultFinanceiro.impostoPercent);
  const impostos = roundMoney(faturamentoBruto * (impostoPercent / 100));
  const despesasPeriodo = refreshDespesas(store).filter((item) => inRange(item.dueDate, start, end));
  const despesasFixas = roundMoney(
    despesasPeriodo.filter((item) => item.type === "fixa").reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  );
  const despesasVariaveis = roundMoney(
    despesasPeriodo.filter((item) => item.type === "variavel").reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  );
  const lucroLiquido = roundMoney(faturamentoBruto - taxas - impostos - cmv - despesasFixas - despesasVariaveis);

  const porMetodo = {};
  for (const metodo of METODOS) {
    const rows = cash.filter((row) => row.metodo === metodo && row.tipo === "entrada");
    porMetodo[metodo] = {
      qtd: rows.length,
      bruto: roundMoney(rows.reduce((sum, row) => sum + (Number(row.bruto) || 0), 0)),
      taxa: roundMoney(rows.reduce((sum, row) => sum + (Number(row.taxa) || 0), 0)),
      liquido: roundMoney(rows.reduce((sum, row) => sum + (Number(row.liquido) || 0), 0))
    };
  }

  return {
    from: start.toISOString(),
    to: end.toISOString(),
    faturamentoBruto,
    taxas,
    impostos,
    impostoPercent,
    cmv,
    despesasFixas,
    despesasVariaveis,
    lucroLiquido,
    vendas: sales.length,
    porMetodo
  };
}

export function upsertDespesa(store, payload, id) {
  const now = new Date().toISOString();
  if (id) {
    const item = (store.expenses || []).find((row) => row.id === id);
    if (!item) return null;
    if (payload.name != null) item.name = String(payload.name);
    if (payload.type) item.type = payload.type === "variavel" ? "variavel" : "fixa";
    if (payload.amount !== undefined && payload.amount !== "") item.amount = Number(payload.amount);
    if (payload.dueDate) item.dueDate = String(payload.dueDate);
    if (payload.category != null) item.category = String(payload.category);
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
    category: String(payload.category || "Geral"),
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
    origem: "despesa",
    saleId: "",
    notaId: "",
    estornado: false,
    note: item.name,
    expenseId: item.id
  });
  return item;
}

export function defaultExpenses() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return [
    { id: "desp-aluguel", name: "Aluguel do ponto", type: "fixa", amount: 2500, dueDate: `${y}-${m}-05`, category: "Ocupação", notes: "", status: "pendente", paidAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: "desp-energia", name: "Energia", type: "fixa", amount: 380, dueDate: `${y}-${m}-10`, category: "Utilidades", notes: "", status: "pendente", paidAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: "desp-gas", name: "Gás", type: "variavel", amount: 220, dueDate: `${y}-${m}-12`, category: "Insumos", notes: "", status: "pendente", paidAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  ];
}
