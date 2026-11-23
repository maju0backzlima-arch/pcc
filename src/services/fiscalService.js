const FOCUS_TOKEN = "";
const FOCUS_BASE_URL = "https://homologacao.focusnfe.com.br";
const PLUGNOTAS_TOKEN = "";
const PLUGNOTAS_BASE_URL = "https://api.plugnotas.com.br";

export const fiscalConfig = {
  provider: "focusnfe",
  token: FOCUS_TOKEN || PLUGNOTAS_TOKEN,
  baseUrl: FOCUS_TOKEN ? FOCUS_BASE_URL : PLUGNOTAS_BASE_URL,
  ready: Boolean(FOCUS_TOKEN || PLUGNOTAS_TOKEN),
  ambiente: "homologacao"
};

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function payloadFromSale(sale, cpf, settings = {}) {
  const emitente = settings.pdvAccount || {};
  return {
    natureza_operacao: "Venda ao consumidor",
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: 1,
    presenca_comprador: 1,
    cnpj_emitente: String(emitente.cnpj || "").replace(/\D/g, ""),
    nome_emitente: emitente.storeName || settings.name || "PIC NIC",
    cpf_destinatario: String(cpf || "").replace(/\D/g, "") || undefined,
    ref: sale.id,
    itens: (sale.items || []).map((item, index) => ({
      numero_item: index + 1,
      codigo_produto: item.sku || item.productId,
      descricao: item.name,
      ncm: String(item.ncm || "21011110").replace(/\D/g, ""),
      cfop: String(item.cfop || "5102"),
      icms_origem: 0,
      icms_situacao_tributaria: String(item.csosn || "102"),
      csosn: String(item.csosn || "102"),
      unidade_comercial: "UN",
      quantidade_comercial: Number(item.qty || 1),
      valor_unitario_comercial: Number(item.price || 0),
      valor_bruto: Number(item.total || 0)
    })),
    formas_pagamento: [
      {
        forma_pagamento: mapPagamento(sale.paymentMethod),
        valor_pagamento: Number(sale.total || 0)
      }
    ]
  };
}

function basicAuth(token) {
  const raw = `${token}:`;
  if (typeof globalThis.btoa === "function") return globalThis.btoa(raw);
  return Buffer.from(raw, "utf8").toString("base64");
}

function mapPagamento(metodo) {
  if (metodo === "dinheiro") return "01";
  if (metodo === "debito") return "04";
  if (metodo === "credito") return "03";
  if (metodo === "voucher") return "10";
  return "17";
}

async function postJson(url, body, token) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${basicAuth(token)}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.mensagem || data.message || "Falha na API fiscal.");
  return data;
}

export async function emitirNFCe(venda, cpf, settings = {}) {
  const payload = payloadFromSale(venda, cpf, settings);
  if (!fiscalConfig.ready) {
    const chave = `NFe35${String(Date.now()).slice(-34)}`;
    return {
      ok: true,
      mock: true,
      status: "autorizada",
      protocolo: uid("prot").replace("prot-", ""),
      chave,
      numero: venda.numeroNfce,
      serie: venda.serieNfce || 1,
      xml: xmlNfce({ ...venda, chave, cpf, payload }),
      danfeUrl: "",
      payload
    };
  }
  const data = await postJson(
    `${fiscalConfig.baseUrl}/v2/nfce?ref=${encodeURIComponent(venda.id)}`,
    payload,
    fiscalConfig.token
  );
  return {
    ok: true,
    mock: false,
    status: String(data.status || "autorizada").toLowerCase(),
    protocolo: data.protocolo || data.protocolo_autorizacao || "",
    chave: data.chave_nfe || data.chave || "",
    numero: data.numero,
    serie: data.serie,
    xml: data.xml || xmlNfce({ ...venda, chave: data.chave_nfe, cpf, payload }),
    danfeUrl: data.caminho_danfe || data.danfe || "",
    payload
  };
}

export async function cancelarNFCe(nota, justificativa, _settings = {}) {
  const motivo = String(justificativa || "").trim();
  if (motivo.length < 15) throw new Error("Justificativa mínima de 15 caracteres.");
  if (!fiscalConfig.ready) {
    return { ok: true, mock: true, status: "cancelada", justificativa: motivo };
  }
  const data = await postJson(
    `${fiscalConfig.baseUrl}/v2/nfce/${encodeURIComponent(nota.ref || nota.saleId)}/cancelamento`,
    { justificativa: motivo },
    fiscalConfig.token
  );
  return { ok: true, mock: false, status: "cancelada", justificativa: motivo, protocolo: data.protocolo || "" };
}

export async function inutilizarNumeracao(numeroInicial, numeroFinal, justificativa, settings = {}) {
  const motivo = String(justificativa || "").trim();
  if (motivo.length < 15) throw new Error("Justificativa mínima de 15 caracteres.");
  const inicio = Number(numeroInicial);
  const fim = Number(numeroFinal);
  if (!(inicio > 0) || fim < inicio) throw new Error("Informe a faixa de numeração.");
  const serie = Number(settings.fiscal?.serie || 1);
  if (!fiscalConfig.ready) {
    return { ok: true, mock: true, status: "inutilizada", numeroInicial: inicio, numeroFinal: fim, serie, justificativa: motivo };
  }
  const data = await postJson(
    `${fiscalConfig.baseUrl}/v2/nfce/inutilizacao`,
    {
      cnpj: String(settings.pdvAccount?.cnpj || "").replace(/\D/g, ""),
      serie,
      numero_inicial: inicio,
      numero_final: fim,
      justificativa: motivo
    },
    fiscalConfig.token
  );
  return { ok: true, mock: false, status: "inutilizada", numeroInicial: inicio, numeroFinal: fim, serie, justificativa: motivo, protocolo: data.protocolo || "" };
}

export function xmlNfce(nota) {
  const itens = (nota.items || nota.payload?.itens || [])
    .map((item, i) => {
      const ncm = item.ncm || item.codigo_ncm || "21011110";
      const cfop = item.cfop || "5102";
      const csosn = item.csosn || item.icms_situacao_tributaria || "102";
      const q = Number(item.qty ?? item.quantidade_comercial ?? 1);
      const v = Number(item.price ?? item.valor_unitario_comercial ?? 0).toFixed(2);
      return `<det nItem="${i + 1}"><prod><cProd>${item.sku || item.codigo_produto || item.productId || ""}</cProd><xProd>${escapeXml(item.name || item.descricao || "")}</xProd><NCM>${ncm}</NCM><CFOP>${cfop}</CFOP><qCom>${q}</qCom><vUnCom>${v}</vUnCom><vProd>${(q * Number(v)).toFixed(2)}</vProd></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>${csosn}</CSOSN></ICMSSN102></ICMS></imposto></det>`;
    })
    .join("");
  const chave = nota.chave || `NFe${String(Date.now())}`;
  const cpf = nota.cpf ? `<CPF>${String(nota.cpf).replace(/\D/g, "")}</CPF>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="${chave}"><ide><mod>65</mod><serie>${nota.serie || 1}</serie><nNF>${nota.numero || 0}</nNF><tpNF>1</tpNF><finNFe>1</finNFe><indFinal>1</indFinal></ide><dest>${cpf}</dest><total><ICMSTot><vNF>${Number(nota.total || 0).toFixed(2)}</vNF></ICMSTot></total>${itens}</infNFe></NFe><protNFe><infProt><nProt>${nota.protocolo || ""}</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function htmlDanfe(nota) {
  const linhas = (nota.items || [])
    .map(
      (item) =>
        `<tr><td>${item.name}</td><td>${item.ncm || ""}</td><td>${item.cfop || ""}</td><td>${item.csosn || ""}</td><td>${item.qty}</td><td>${Number(item.total || 0).toFixed(2)}</td></tr>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>DANFE NFC-e ${nota.numero}</title><style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px;text-align:left}</style></head><body><h1>DANFE NFC-e ${nota.numero || ""}</h1><p>Chave ${nota.chave || "—"} · Protocolo ${nota.protocolo || "—"} · ${nota.status}</p><table><thead><tr><th>Item</th><th>NCM</th><th>CFOP</th><th>CSOSN</th><th>Qtd</th><th>Total</th></tr></thead><tbody>${linhas}</tbody></table></body></html>`;
}
