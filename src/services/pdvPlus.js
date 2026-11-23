const PDVPLUS_API_KEY = "";
const PDVPLUS_BASE_URL = "https://api.pdvplus.placeholder.local";
const PDVPLUS_WEBHOOK_SECRET = "picnic-pdvplus";

const METODOS = ["pix", "credito", "debito", "dinheiro"];

export const pdvPlusConfig = {
  apiKey: PDVPLUS_API_KEY,
  baseUrl: PDVPLUS_BASE_URL,
  webhookSecret: PDVPLUS_WEBHOOK_SECRET,
  ready: Boolean(PDVPLUS_API_KEY)
};

export function normalizarVenda(venda = {}) {
  const items = Array.isArray(venda.items)
    ? venda.items
    : Array.isArray(venda.itens)
      ? venda.itens
      : Array.isArray(venda.produtos)
        ? venda.produtos
        : [];
  const metodo = String(venda.paymentMethod || venda.metodo || venda.formaPagamento || "pix")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const mapped = metodo.includes("cred") ? "credito" : metodo.includes("deb") ? "debito" : metodo.includes("din") ? "dinheiro" : "pix";
  return {
    id: venda.id || venda.vendaId || "",
    at: venda.at || venda.data || new Date().toISOString(),
    source: "pdvplus",
    paymentMethod: METODOS.includes(mapped) ? mapped : "pix",
    note: venda.note || venda.observacao || "",
    items: items.map((line) => ({
      productId: line.productId || line.id || line.produtoId,
      sku: line.sku,
      name: line.name || line.nome,
      qty: Number(line.qty ?? line.quantidade ?? 1)
    }))
  };
}

export async function pullSales() {
  if (!pdvPlusConfig.apiKey) {
    return { ok: false, mock: true, sales: [], message: "PDV+ API key não configurada. Preencha pdvPlusConfig.apiKey." };
  }
  const res = await fetch(`${pdvPlusConfig.baseUrl}/v1/sales`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${pdvPlusConfig.apiKey}`
    }
  });
  if (!res.ok) throw new Error("Falha ao consultar vendas no PDV+.");
  const data = await res.json();
  return { ok: true, mock: false, sales: (data.sales || data.vendas || []).map(normalizarVenda) };
}

export { METODOS };
