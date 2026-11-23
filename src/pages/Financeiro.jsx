import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { errorMessage } from "../errors.js";
import { METODO_LABEL, METODOS } from "../modules/financeiro/engine.js";

function money(value) {
  return (Number(value) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function when(value) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function monthRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

const STATUS_LABEL = { pago: "Pago", pendente: "Pendente", atrasado: "Atrasado" };

export default function Financeiro({ user }) {
  const range = monthRange();
  const [dash, setDash] = useState({ dre: {}, cashFlow: [], expenses: [], financeiro: { taxas: {}, impostoPercent: 6 } });
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [taxas, setTaxas] = useState({ pix: 0, credito: 3.49, debito: 1.99, dinheiro: 0 });
  const [imposto, setImposto] = useState(6);
  const [tab, setTab] = useState("dre");
  const [nova, setNova] = useState({ name: "", type: "fixa", amount: 0, dueDate: range.from, category: "Geral", notes: "" });

  function apply(data) {
    setDash(data);
    if (data.financeiro?.taxas) setTaxas({ pix: 0, credito: 3.49, debito: 1.99, dinheiro: 0, ...data.financeiro.taxas });
    if (data.financeiro?.impostoPercent != null) setImposto(data.financeiro.impostoPercent);
  }

  useEffect(() => {
    if (!user) return;
    api.financeiro(from, to).then(apply).catch((err) => setError(errorMessage(err)));
  }, [user, from, to]);

  if (!user) return <Navigate to="/login" replace />;

  const dre = dash.dre || {};
  const cards = [
    { label: "Faturamento bruto", value: dre.faturamentoBruto, tone: "wine" },
    { label: "Taxas / impostos", value: (Number(dre.taxas) || 0) + (Number(dre.impostos) || 0), tone: "gold" },
    { label: "CMV", value: dre.cmv, tone: "" },
    { label: "Despesas fixas", value: dre.despesasFixas, tone: "" },
    { label: "Lucro líquido", value: dre.lucroLiquido, tone: Number(dre.lucroLiquido) >= 0 ? "wine" : "gold" }
  ];

  const fluxo = useMemo(() => dash.cashFlow || [], [dash.cashFlow]);
  const despesas = useMemo(() => dash.expenses || [], [dash.expenses]);

  async function run(task, ok) {
    setBusy(true);
    setError("");
    try {
      const data = await task();
      apply(data);
      if (ok) setMessage(ok);
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
          <p className="kicker">Módulo 2</p>
          <h2>Financeiro e DRE</h2>
        </div>
        <p>Entradas do PDV+ por método, contas a pagar e DRE do período.</p>
      </div>

      {message ? <p className="ok">{message}</p> : null}
      {error ? <p className="err">{error}</p> : null}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row">
          <label>
            De
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Até
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="dre-grid">
        {cards.map((card) => (
          <article key={card.label} className={`banner ${card.tone}`}>
            <strong>{money(card.value)}</strong>
            <span>{card.label}</span>
          </article>
        ))}
      </div>

      <div className="cats">
        <button className={`tab ${tab === "dre" ? "active" : ""}`} onClick={() => setTab("dre")}>DRE</button>
        <button className={`tab ${tab === "caixa" ? "active" : ""}`} onClick={() => setTab("caixa")}>Fluxo de caixa</button>
        <button className={`tab ${tab === "contas" ? "active" : ""}`} onClick={() => setTab("contas")}>Contas</button>
        <button className={`tab ${tab === "taxas" ? "active" : ""}`} onClick={() => setTab("taxas")}>Taxas</button>
      </div>

      {tab === "dre" ? (
        <div className="card">
          <h3>Resumo do período</h3>
          <table className="admin-table">
            <tbody>
              <tr><td>Vendas</td><td>{dre.vendas || 0}</td></tr>
              <tr><td>Faturamento bruto</td><td>{money(dre.faturamentoBruto)}</td></tr>
              <tr><td>Taxas de maquininha</td><td>{money(dre.taxas)}</td></tr>
              <tr><td>Impostos ({dre.impostoPercent || 0}%)</td><td>{money(dre.impostos)}</td></tr>
              <tr><td>CMV</td><td>{money(dre.cmv)}</td></tr>
              <tr><td>Despesas fixas</td><td>{money(dre.despesasFixas)}</td></tr>
              <tr><td>Despesas variáveis</td><td>{money(dre.despesasVariaveis)}</td></tr>
              <tr><td><strong>Lucro líquido</strong></td><td><strong>{money(dre.lucroLiquido)}</strong></td></tr>
            </tbody>
          </table>
          <h3 style={{ marginTop: 22 }}>Por método</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Método</th>
                <th>Qtd</th>
                <th>Bruto</th>
                <th>Taxa</th>
                <th>Líquido</th>
              </tr>
            </thead>
            <tbody>
              {METODOS.map((metodo) => {
                const row = dre.porMetodo?.[metodo] || { qtd: 0, bruto: 0, taxa: 0, liquido: 0 };
                return (
                  <tr key={metodo}>
                    <td>{METODO_LABEL[metodo]}</td>
                    <td>{row.qtd}</td>
                    <td>{money(row.bruto)}</td>
                    <td>{money(row.taxa)}</td>
                    <td>{money(row.liquido)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "caixa" ? (
        <div className="card">
          <h3>Movimentações</h3>
          {fluxo.length === 0 ? (
            <p className="muted">Nenhuma entrada ainda. Vendas do PDV+ aparecem aqui automaticamente.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Tipo</th>
                  <th>Método</th>
                  <th>Bruto</th>
                  <th>Taxa</th>
                  <th>Líquido</th>
                  <th>Obs</th>
                </tr>
              </thead>
              <tbody>
                {fluxo.map((row) => (
                  <tr key={row.id} className={row.estornado ? "off-row" : ""}>
                    <td>{when(row.at)}</td>
                    <td>{row.tipo}</td>
                    <td>{METODO_LABEL[row.metodo] || row.metodo}</td>
                    <td>{money(row.bruto)}</td>
                    <td>{money(row.taxa)}</td>
                    <td>{money(row.liquido)}</td>
                    <td>{row.note}{row.estornado ? " · estornado" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {tab === "contas" ? (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>Nova despesa</h3>
            <div className="form two">
              <label>
                Nome
                <input value={nova.name} onChange={(e) => setNova({ ...nova, name: e.target.value })} />
              </label>
              <label>
                Tipo
                <select value={nova.type} onChange={(e) => setNova({ ...nova, type: e.target.value })}>
                  <option value="fixa">Fixa</option>
                  <option value="variavel">Variável</option>
                </select>
              </label>
              <label>
                Valor
                <input type="number" min="0" step="0.01" value={nova.amount} onChange={(e) => setNova({ ...nova, amount: e.target.value })} />
              </label>
              <label>
                Vencimento
                <input type="date" value={nova.dueDate} onChange={(e) => setNova({ ...nova, dueDate: e.target.value })} />
              </label>
              <label>
                Categoria
                <input value={nova.category} onChange={(e) => setNova({ ...nova, category: e.target.value })} />
              </label>
              <label>
                Notas
                <input value={nova.notes} onChange={(e) => setNova({ ...nova, notes: e.target.value })} />
              </label>
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={async () => {
                await run(() => api.createDespesa(nova), "Despesa lançada.");
                setNova({ name: "", type: "fixa", amount: 0, dueDate: from, category: "Geral", notes: "" });
              }}
            >
              Lançar
            </button>
          </div>
          <div className="card">
            <h3>Contas a pagar / receber</h3>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {despesas.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.type === "fixa" ? "Fixa" : "Variável"}</td>
                    <td>{money(item.amount)}</td>
                    <td>{item.dueDate}</td>
                    <td>
                      <span className={`prio ${item.status === "atrasado" ? "urgente" : item.status === "pago" ? "planejado" : "atencao"}`}>
                        {STATUS_LABEL[item.status] || item.status}
                      </span>
                    </td>
                    <td>
                      <div className="row">
                        {item.status !== "pago" ? (
                          <button className="btn btn-gold" disabled={busy} onClick={() => run(() => api.pagarDespesa(item.id), `${item.name} paga.`)}>
                            Marcar pago
                          </button>
                        ) : null}
                        <button className="btn btn-ghost" disabled={busy} onClick={() => run(() => api.removeDespesa(item.id), "Despesa removida.")}>
                          Tirar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "taxas" ? (
        <div className="card">
          <h3>Taxas da maquininha (%)</h3>
          <div className="form two">
            {METODOS.map((metodo) => (
              <label key={metodo}>
                {METODO_LABEL[metodo]}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={taxas[metodo]}
                  onChange={(e) => setTaxas({ ...taxas, [metodo]: e.target.value })}
                />
              </label>
            ))}
            <label>
              Imposto sobre faturamento (%)
              <input type="number" min="0" step="0.1" value={imposto} onChange={(e) => setImposto(e.target.value)} />
            </label>
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={busy}
            onClick={() => run(() => api.updateTaxas({ taxas, impostoPercent: Number(imposto) }), "Taxas salvas.")}
          >
            Salvar taxas
          </button>
        </div>
      ) : null}
    </main>
  );
}
