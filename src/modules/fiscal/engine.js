import { emitirNFCe, cancelarNFCe, inutilizarNumeracao, xmlNfce, htmlDanfe } from "../../services/fiscalService.js";
import { normalizeProdutoVenda } from "../estoque/cafeteria.js";

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const STATUS_NOTA = {
  autorizada: "Autorizada",
  cancelada: "Cancelada",
  inutilizada: "Inutilizada",
  rejeitada: "Rejeitada"
};

export function defaultFiscal() {
  return { serie: 1, proximoNumero: 1, ambiente: "homologacao" };
}

export function nextNumero(store) {
  store.settings = store.settings || {};
  store.settings.fiscal = { ...defaultFiscal(), ...(store.settings.fiscal || {}) };
  const n = Number(store.settings.fiscal.proximoNumero || 1);
  store.settings.fiscal.proximoNumero = n + 1;
  return n;
}

export function itensFiscais(store, sale) {
  return (sale.items || []).map((line) => {
    const product = (store.products || []).find((item) => item.id === line.productId);
    const prod = product ? normalizeProdutoVenda(product) : {};
    return {
      ...line,
      ncm: line.ncm || prod.ncm || "21011110",
      cfop: line.cfop || prod.cfop || "5102",
      csosn: line.csosn || prod.csosn || "102"
    };
  });
}

export async function emitirNota(store, vendaId, cpf) {
  const sale = (store.sales || []).find((item) => item.id === vendaId);
  if (!sale) return null;
  if (sale.estornada) throw new Error("Venda estornada não emite NFC-e.");
  store.notas = store.notas || [];
  const existente = store.notas.find((n) => n.saleId === vendaId && n.status === "autorizada");
  if (existente) return existente;
  const numero = nextNumero(store);
  const serie = Number(store.settings?.fiscal?.serie || 1);
  const items = itensFiscais(store, sale);
  const result = await emitirNFCe(
    { ...sale, items, numeroNfce: numero, serieNfce: serie },
    cpf,
    store.settings || {}
  );
  const nota = {
    id: uid("nfce"),
    saleId: sale.id,
    at: new Date().toISOString(),
    status: result.status || "autorizada",
    numero: result.numero || numero,
    serie: result.serie || serie,
    chave: result.chave || "",
    protocolo: result.protocolo || "",
    cpf: String(cpf || "").replace(/\D/g, ""),
    total: Number(sale.total || 0),
    xml: result.xml || xmlNfce({ ...sale, items, numero, serie, chave: result.chave, protocolo: result.protocolo, cpf }),
    danfeHtml: htmlDanfe({ ...sale, items, numero, serie, chave: result.chave, protocolo: result.protocolo, status: result.status || "autorizada" }),
    danfeUrl: result.danfeUrl || "",
    mock: Boolean(result.mock),
    items,
    justificativa: "",
    paymentMethod: sale.paymentMethod
  };
  store.notas.unshift(nota);
  sale.notaId = nota.id;
  sale.nfce = { id: nota.id, numero: nota.numero, status: nota.status, chave: nota.chave };
  return nota;
}

export async function cancelarNota(store, notaId, justificativa, reverseSale) {
  const nota = (store.notas || []).find((item) => item.id === notaId);
  if (!nota) return null;
  if (nota.status !== "autorizada") throw new Error("Só notas autorizadas podem ser canceladas.");
  const result = await cancelarNFCe(nota, justificativa, store.settings || {});
  nota.status = "cancelada";
  nota.justificativa = result.justificativa;
  nota.canceladaAt = new Date().toISOString();
  const sale = (store.sales || []).find((item) => item.id === nota.saleId);
  if (sale) {
    sale.nfce = { ...(sale.nfce || {}), status: "cancelada" };
    if (typeof reverseSale === "function" && !sale.estornada) reverseSale(store, sale);
  }
  return nota;
}

export async function inutilizarFaixa(store, numeroInicial, numeroFinal, justificativa) {
  const result = await inutilizarNumeracao(numeroInicial, numeroFinal, justificativa, store.settings || {});
  store.notas = store.notas || [];
  const nota = {
    id: uid("inut"),
    saleId: "",
    at: new Date().toISOString(),
    status: "inutilizada",
    numero: result.numeroInicial,
    numeroFinal: result.numeroFinal,
    serie: result.serie,
    chave: "",
    protocolo: result.protocolo || "",
    cpf: "",
    total: 0,
    xml: `<?xml version="1.0"?><inutNFe><infInut><serie>${result.serie}</serie><nNFIni>${result.numeroInicial}</nNFIni><nNFFin>${result.numeroFinal}</nNFFin><xJust>${result.justificativa}</xJust></infInut></inutNFe>`,
    danfeHtml: "",
    mock: Boolean(result.mock),
    items: [],
    justificativa: result.justificativa
  };
  store.notas.unshift(nota);
  const prox = Number(store.settings?.fiscal?.proximoNumero || 1);
  if (result.numeroFinal >= prox) {
    store.settings.fiscal = { ...defaultFiscal(), ...(store.settings.fiscal || {}), proximoNumero: result.numeroFinal + 1 };
  }
  return nota;
}

export function notasDoMes(store, ym) {
  const month = ym || new Date().toISOString().slice(0, 7);
  return (store.notas || []).filter((nota) => String(nota.at || "").startsWith(month));
}

export function xmlsDoMes(store, ym) {
  return notasDoMes(store, ym)
    .filter((nota) => nota.xml)
    .map((nota) => ({
      name: `${nota.status}-${nota.numero || nota.id}.xml`,
      content: nota.xml
    }));
}
