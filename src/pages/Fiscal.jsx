import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { errorMessage } from "../errors.js";
import { canCancelFiscal } from "../auth/permissoes.js";
import { STATUS_NOTA } from "../modules/fiscal/engine.js";
import { downloadBlob, zipFiles } from "../modules/fiscal/zip.js";

function money(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function when(v) {
  return v ? new Date(v).toLocaleString("pt-BR") : "—";
}
function monthNow() {
  return new Date().toISOString().slice(0, 7);
}

export default function Fiscal({ user }) {
  const [dash, setDash] = useState({ notas: [], sales: [] });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cpf, setCpf] = useState("");
  const [vendaId, setVendaId] = useState("");
  const [just, setJust] = useState("");
  const [inut, setInut] = useState({ numeroInicial: 1, numeroFinal: 1, justificativa: "" });
  const [month, setMonth] = useState(monthNow());
  const gerente = canCancelFiscal(user);

  function apply(data) {
    setDash(data);
  }

  useEffect(() => {
    if (!user) return;
    api.notas().then(apply).catch((err) => setError(errorMessage(err)));
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  const vendasAbertas = useMemo(
    () => (dash.sales || []).filter((sale) => !sale.estornada && sale.nfce?.status !== "autorizada"),
    [dash.sales]
  );

  async function run(task, ok) {
    setBusy(true);
    setError("");
    try {
      const data = await task();
      if (data?.notas || data?.sales) apply(data);
      if (ok) setMessage(ok);
      return data;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function baixarXml(nota) {
    downloadBlob(`NFCe-${nota.numero || nota.id}.xml`, new TextEncoder().encode(nota.xml || ""), "application/xml");
  }

  function baixarDanfe(nota) {
    if (nota.danfeUrl) {
      window.open(nota.danfeUrl, "_blank");
      return;
    }
    const html = nota.danfeHtml || `<p>NFC-e ${nota.numero}</p>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    } else {
      downloadBlob(`DANFE-${nota.numero || nota.id}.html`, new TextEncoder().encode(html), "text/html");
    }
  }

  async function exportarMes() {
    setBusy(true);
    setError("");
    try {
      const data = await api.xmlsMes(month);
      const files = data.files || [];
      if (!files.length) {
        setError("Nenhum XML no mês.");
        return;
      }
      downloadBlob(`nfce-${month}.zip`, zipFiles(files), "application/zip");
      setMessage("ZIP do mês gerado.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page admin-page">
      <div className="section-head">
        <div>
          <p className="kicker">Simples Nacional · NFC-e modelo 65</p>
          <h2>Notas fiscais</h2>
        </div>
        <p>Emissão com NCM, CFOP e CSOSN 102/500. Cancelamento estorna caixa e estoque.</p>
      </div>

      {message ? <p className="ok">{message}</p> : null}
      {error ? <p className="err">{error}</p> : null}

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>Emitir NFC-e</h3>
          <div className="form">
            <label>Venda
              <select value={vendaId} onChange={(e) => setVendaId(e.target.value)}>
                <option value="">Selecione</option>
                {vendasAbertas.map((sale) => (
                  <option key={sale.id} value={sale.id}>
                    {when(sale.at)} · {money(sale.total)} · {sale.id}
                  </option>
                ))}
              </select>
            </label>
            <label>CPF no cupom (opcional)
              <input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="Somente números" />
            </label>
            <button
              className="btn btn-primary"
              disabled={busy || !vendaId}
              onClick={() => run(() => api.emitirNfce({ vendaId, cpf }), "NFC-e autorizada.")}
            >
              Emitir
            </button>
          </div>
        </div>
        <div className="card">
          <h3>Exportar para o contador</h3>
          <div className="form">
            <label>Mês
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
            <button className="btn btn-gold" disabled={busy} onClick={exportarMes}>
              Exportar XMLs do mês (.zip)
            </button>
          </div>
          {gerente ? (
            <div className="form" style={{ marginTop: 16 }}>
              <h3>Inutilizar numeração</h3>
              <label>Inicial<input type="number" min="1" value={inut.numeroInicial} onChange={(e) => setInut({ ...inut, numeroInicial: e.target.value })} /></label>
              <label>Final<input type="number" min="1" value={inut.numeroFinal} onChange={(e) => setInut({ ...inut, numeroFinal: e.target.value })} /></label>
              <label>Justificativa
                <input value={inut.justificativa} onChange={(e) => setInut({ ...inut, justificativa: e.target.value })} placeholder="Mínimo 15 caracteres" />
              </label>
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => run(() => api.inutilizarNfce(inut), "Faixa inutilizada.")}
              >
                Inutilizar
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <h3>Notas</h3>
        {gerente ? (
          <label style={{ maxWidth: 420, marginBottom: 12 }}>
            Justificativa de cancelamento
            <input value={just} onChange={(e) => setJust(e.target.value)} placeholder="Mínimo 15 caracteres" />
          </label>
        ) : null}
        <table className="admin-table">
          <thead>
            <tr>
              <th>Número</th>
              <th>Quando</th>
              <th>Status</th>
              <th>Total</th>
              <th>Chave</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(dash.notas || []).map((nota) => (
              <tr key={nota.id} className={nota.status === "cancelada" ? "off-row" : ""}>
                <td>{nota.status === "inutilizada" ? `${nota.numero}–${nota.numeroFinal}` : nota.numero}</td>
                <td>{when(nota.at)}</td>
                <td>
                  <span className={`prio ${nota.status === "autorizada" ? "planejado" : nota.status === "cancelada" ? "urgente" : "atencao"}`}>
                    {STATUS_NOTA[nota.status] || nota.status}
                  </span>
                </td>
                <td>{money(nota.total)}</td>
                <td className="muted">{nota.chave ? `${String(nota.chave).slice(0, 16)}…` : "—"}</td>
                <td>
                  {nota.xml ? <button className="btn btn-ghost" onClick={() => baixarXml(nota)}>XML</button> : null}
                  {nota.status === "autorizada" ? <button className="btn btn-ghost" onClick={() => baixarDanfe(nota)}>DANFE</button> : null}
                  {gerente && nota.status === "autorizada" ? (
                    <button
                      className="btn btn-gold"
                      disabled={busy}
                      onClick={() => run(() => api.cancelarNfce({ notaId: nota.id, justificativa: just }), "NFC-e cancelada. Caixa e estoque estornados.")}
                    >
                      Cancelar
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
