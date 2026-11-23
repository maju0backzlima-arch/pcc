import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Banknote, Percent, Receipt, TriangleAlert, TrendingUp, Wallet } from "lucide-react";
import { api } from "../api.js";
import { errorMessage } from "../errors.js";
import { CATEGORIAS, CMV_ALERTA, METODO_LABEL, METODOS, SETTLEMENT_DAYS } from "../modules/financeiro/engine.js";
import { canSeeDre } from "../auth/permissoes.js";
import { Btn, Count, InlineCell, QuickSelect, TabBtn, useToast } from "../ui/ui.jsx";

function money(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function when(v) {
  return v ? new Date(v).toLocaleString("pt-BR") : "—";
}
function dayLabel(iso) {
  return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
}
function monthRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

const TABS = [
  { id: "dre", label: "DRE" },
  { id: "caixa", label: "Caixa" },
  { id: "conferencia", label: "Conferência" },
  { id: "contas", label: "A pagar" },
  { id: "receber", label: "A receber" },
  { id: "taxas", label: "Taxas" }
];

export default function Financeiro({ user, search = "" }) {
  const range = monthRange();
  const [dash, setDash] = useState({
    dre: {},
    cashFlow: [],
    expenses: [],
    receivables: [],
    financeiro: { taxas: {} },
    fechamentos: [],
    caixaDia: { porMetodo: {} }
  });
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const gerente = canSeeDre(user);
  const toast = useToast();
  const [tab, setTab] = useState(gerente ? "dre" : "caixa");
  const [taxas, setTaxas] = useState({ pix: 0, credito: 3.49, debito: 1.99, voucher: 0, dinheiro: 0 });
  const [imposto, setImposto] = useState(6);
  const [nova, setNova] = useState({
    name: "",
    type: "fixa",
    amount: 0,
    dueDate: range.from,
    category: "Fornecedores",
    notes: ""
  });
  const [manual, setManual] = useState({ tipo: "entrada", metodo: "pix", amount: 0, note: "" });
  const [caixa, setCaixa] = useState({ tipo: "sangria", amount: 0, note: "" });
  const [receber, setReceber] = useState({ name: "", amount: 0, dueDate: range.from, notes: "" });
  const [confDate, setConfDate] = useState(today());
  const [gaveta, setGaveta] = useState({ pix: "", credito: "", debito: "", voucher: "", dinheiro: "" });

  function apply(data) {
    setDash(data);
    if (data.financeiro?.taxas) {
      setTaxas({ pix: 0, credito: 3.49, debito: 1.99, voucher: 0, dinheiro: 0, ...data.financeiro.taxas });
    }
    if (data.financeiro?.impostoPercent != null) setImposto(data.financeiro.impostoPercent);
    if (data.caixaDia?.porMetodo) {
      setGaveta((prev) => {
        const next = { ...prev };
        for (const m of METODOS) {
          if (next[m] === "" || next[m] == null) next[m] = Number(data.caixaDia.porMetodo[m] || 0);
        }
        return next;
      });
    }
  }

  useEffect(() => {
    if (!user) return;
    api.financeiro(from, to).then(apply).catch((err) => setError(errorMessage(err)));
  }, [user, from, to]);

  useEffect(() => {
    if (!canSeeDre(user) && ["dre", "taxas", "contas", "receber"].includes(tab)) setTab("caixa");
  }, [user, tab]);

  if (!user) return <Navigate to="/login" replace />;

  const dre = dash.dre || {};
  const caixaDia = dash.caixaDia || { porMetodo: {} };
  const cmvPct = dre.faturamentoBruto > 0 ? (Number(dre.cmv) / Number(dre.faturamentoBruto)) * 100 : 0;
  const cmvAlto = cmvPct > Number(dash.financeiro?.cmvAlerta || CMV_ALERTA);

  async function run(task, ok) {
    setBusy(true);
    setError("");
    try {
      const data = await task();
      apply(data);
      if (ok) toast(ok);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadDia(date) {
    setConfDate(date);
    setBusy(true);
    try {
      const data = await api.caixaDia(date);
      apply(data);
      const por = data.caixaDia?.porMetodo || {};
      const next = {};
      for (const m of METODOS) next[m] = Number(por[m] || 0);
      setGaveta(next);
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
          <p className="kicker">Simples Nacional · DAS {dre.impostoPercent || 6}%</p>
          <h2>Controle financeiro</h2>
        </div>
        <p>Caixa, conciliação PDV+, conferência de gaveta e DRE do mês.</p>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <label>De<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Até<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </div>

      {gerente ? (
      <>
      <div className="bento">
        <article className="kpi-card">
          <span className="kpi-icon brown"><Wallet size={16} /></span>
          <span className="kpi-label">Faturamento bruto</span>
          <strong className="kpi-value"><Count value={dre.faturamentoBruto} money /></strong>
          <span className="kpi-badge up">{dre.vendas || 0} vendas</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon amber"><Percent size={16} /></span>
          <span className="kpi-label">DAS</span>
          <strong className="kpi-value"><Count value={dre.impostoDas ?? dre.impostos} money /></strong>
          <span className="kpi-badge up">{dre.impostoPercent || 6}%</span>
        </article>
        <article className="kpi-card">
          <span className={`kpi-icon ${cmvAlto ? "red" : "green"}`}><TriangleAlert size={16} /></span>
          <span className="kpi-label">CMV</span>
          <strong className="kpi-value"><Count value={dre.cmv} money /></strong>
          <span className={`kpi-badge ${cmvAlto ? "down" : "up"}`}>{cmvPct.toFixed(1)}%{cmvAlto ? ` · >${CMV_ALERTA}%` : ""}</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon green"><TrendingUp size={16} /></span>
          <span className="kpi-label">Lucro líquido</span>
          <strong className="kpi-value"><Count value={dre.lucroLiquido} money /></strong>
          <span className="kpi-badge up">Após DAS e CMV</span>
        </article>
      </div>
      <div className="bento-main">
        <div className="card">
          <h3>DRE do mês</h3>
          <div className="dre-bar">
            {[
              ["Bruto", dre.faturamentoBruto, dre.faturamentoBruto],
              ["DAS", dre.impostoDas ?? dre.impostos, dre.faturamentoBruto],
              ["Taxas", dre.taxasCartao ?? dre.taxas, dre.faturamentoBruto],
              ["CMV", dre.cmv, dre.faturamentoBruto],
              ["Líquido", dre.lucroLiquido, dre.faturamentoBruto]
            ].map(([label, value, base]) => (
              <div className="bar-row" key={label}>
                <span>{label}</span>
                <i><span style={{ width: `${base ? Math.min(100, (Number(value || 0) / Number(base)) * 100) : 0}%` }} /></i>
                <span className="tabular">{money(value)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Alertas de estoque / CMV</h3>
          <ul className="alert-list">
            <li className="alert-item">
              <b>CMV {cmvPct.toFixed(1)}%</b>
              <span className={cmvAlto ? "err" : "ok"}>{cmvAlto ? "Acima do alerta" : "Dentro da meta"}</span>
            </li>
            <li className="alert-item">
              <b>Taxas cartão</b>
              <span className="tabular">{money(dre.taxasCartao ?? dre.taxas)}</span>
            </li>
            <li className="alert-item">
              <b>Perdas</b>
              <span className="tabular">{money(dre.perdas)}</span>
            </li>
            <li className="alert-item">
              <b>A receber</b>
              <span className="tabular">{money(dre.aReceber)}</span>
            </li>
          </ul>
        </div>
      </div>
      </>
      ) : (
      <div className="bento">
        <article className="kpi-card">
          <span className="kpi-icon brown"><Banknote size={16} /></span>
          <span className="kpi-label">Vendas do sistema</span>
          <strong className="kpi-value"><Count value={caixaDia.sistema} money /></strong>
          <span className="kpi-badge up">Turno</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon amber"><Receipt size={16} /></span>
          <span className="kpi-label">Cupons</span>
          <strong className="kpi-value"><Count value={caixaDia.vendas || 0} /></strong>
          <span className="kpi-badge up">PDV+</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon green"><Wallet size={16} /></span>
          <span className="kpi-label">Fundo de caixa</span>
          <strong className="kpi-value"><Count value={caixaDia.fundoCaixa} money /></strong>
          <span className="kpi-badge up">Gaveta</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon blue"><TrendingUp size={16} /></span>
          <span className="kpi-label">Líquido do dia</span>
          <strong className="kpi-value"><Count value={caixaDia.sistema} money /></strong>
          <span className="kpi-badge up">Conferência</span>
        </article>
      </div>
      )}

      <div className="cats">
        {TABS.filter((item) => gerente || !["dre", "taxas", "contas", "receber"].includes(item.id)).map((item) => (
          <TabBtn key={item.id} active={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </TabBtn>
        ))}
      </div>

      {tab === "dre" && gerente ? (
        <div className="split">
          <div className="card">
            <h3>DRE mensal</h3>
            <table className="admin-table">
              <tbody>
                <tr><td>Vendas / ticket médio</td><td>{dre.vendas || 0} · {money(dre.ticketMedio)}</td></tr>
                <tr><td>Faturamento bruto</td><td>{money(dre.faturamentoBruto)}</td></tr>
                <tr><td>(-) DAS Simples Nacional</td><td>{money(dre.impostoDas ?? dre.impostos)}</td></tr>
                <tr><td>(-) Taxas crédito/débito/voucher</td><td>{money(dre.taxasCartao ?? dre.taxas)}</td></tr>
                <tr className={cmvAlto ? "cmv-alerta" : ""}>
                  <td>(-) CMV{cmvAlto ? ` · ${cmvPct.toFixed(1)}% (alerta ${CMV_ALERTA}%)` : ` · ${cmvPct.toFixed(1)}%`}</td>
                  <td>{money(dre.cmv)}</td>
                </tr>
                <tr><td><b>Lucro bruto</b></td><td><b>{money(dre.lucroBruto)}</b></td></tr>
                <tr><td>(-) Despesas fixas</td><td>{money(dre.despesasFixas)}</td></tr>
                <tr><td>(-) Despesas variáveis</td><td>{money(dre.despesasVariaveis)}</td></tr>
                <tr><td>(-) Perdas</td><td>{money(dre.perdas)}</td></tr>
                <tr><td><b>Lucro líquido</b></td><td><b>{money(dre.lucroLiquido)}</b></td></tr>
                <tr><td>Saldo de caixa</td><td>{money(dre.saldoCaixa)}</td></tr>
                <tr><td>A receber no período</td><td>{money(dre.aReceber)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Por método · D+1 / D+30</h3>
            <table className="admin-table">
              <thead><tr><th>Método</th><th>Prazo</th><th>Bruto</th><th>Líquido</th><th>A receber</th></tr></thead>
              <tbody>
                {METODOS.map((m) => {
                  const row = dre.porMetodo?.[m] || { qtd: 0, bruto: 0, liquido: 0, aReceber: 0 };
                  const days = dash.financeiro?.settlementDays?.[m] ?? SETTLEMENT_DAYS[m] ?? 0;
                  return (
                    <tr key={m}>
                      <td>{METODO_LABEL[m]} · {row.qtd}</td>
                      <td>{days === 0 ? "Na hora" : `D+${days}`}</td>
                      <td>{money(row.bruto)}</td>
                      <td>{money(row.liquido)}</td>
                      <td>{money(row.aReceber)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <h3 style={{ marginTop: 18 }}>Por categoria</h3>
            <table className="admin-table">
              <tbody>
                {CATEGORIAS.map((cat) => (
                  <tr key={cat}><td>{cat}</td><td>{money(dre.porCategoria?.[cat])}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "caixa" ? (
        <>
          <div className="split" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3>Lançamento manual</h3>
              <div className="form">
                <label>Tipo
                  <select value={manual.tipo} onChange={(e) => setManual({ ...manual, tipo: e.target.value })}>
                    <option value="entrada">Entrada</option>
                    <option value="saida">Saída</option>
                  </select>
                </label>
                <label>Método
                  <select value={manual.metodo} onChange={(e) => setManual({ ...manual, metodo: e.target.value })}>
                    {METODOS.map((m) => <option key={m} value={m}>{METODO_LABEL[m]}</option>)}
                  </select>
                </label>
                <label>Valor<input type="number" inputMode="decimal" min="0" step="0.01" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} /></label>
                <label>Descrição<input value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} /></label>
                <Btn className="btn-primary" disabled={busy} onClick={() => run(() => api.lancarCaixa(manual), "Lançamento gravado.")}>Lançar</Btn>
              </div>
            </div>
            <div className="card">
              <h3>Sangria / suprimento</h3>
              <div className="form">
                <label>Tipo
                  <select value={caixa.tipo} onChange={(e) => setCaixa({ ...caixa, tipo: e.target.value })}>
                    <option value="sangria">Sangria</option>
                    <option value="suprimento">Suprimento</option>
                  </select>
                </label>
                <label>Valor<input type="number" inputMode="decimal" min="0" step="0.01" value={caixa.amount} onChange={(e) => setCaixa({ ...caixa, amount: e.target.value })} /></label>
                <label>Motivo<input value={caixa.note} onChange={(e) => setCaixa({ ...caixa, note: e.target.value })} /></label>
                <Btn className="btn-gold" disabled={busy} onClick={() => run(() => api.sangria(caixa), "Caixa atualizado.")}>Confirmar</Btn>
              </div>
            </div>
          </div>
          <div className="card">
            <h3>Movimentações</h3>
            <table className="admin-table">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Método</th><th>Líquido</th><th>Recebe em</th><th>Obs</th></tr></thead>
              <tbody>
                {(dash.cashFlow || []).map((row) => (
                  <tr key={row.id} className={row.estornado ? "off-row" : ""}>
                    <td>{when(row.at)}</td>
                    <td>{row.tipo}</td>
                    <td>{METODO_LABEL[row.metodo] || row.metodo}{row.settlementDays ? ` D+${row.settlementDays}` : ""}</td>
                    <td>{money(row.liquido)}</td>
                    <td>{dayLabel(row.dataRecebimento)}</td>
                    <td>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "conferencia" ? (
        <>
          <div className="split" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3>Gaveta vs sistema</h3>
              <label>Dia
                <input type="date" value={confDate} onChange={(e) => loadDia(e.target.value)} />
              </label>
              <p className="muted" style={{ margin: "8px 0 12px" }}>
                {caixaDia.vendas || 0} venda(s) · sistema {money(caixaDia.sistema)} · fundo {money(caixaDia.fundoCaixa)}
              </p>
              <table className="admin-table">
                <thead><tr><th>Método</th><th>Sistema</th><th>Gaveta / maquininha</th><th>Diferença</th></tr></thead>
                <tbody>
                  {METODOS.map((m) => {
                    const sistema = Number(caixaDia.porMetodo?.[m] || 0);
                    const informado = Number(gaveta[m] || 0);
                    const diff = Math.round((informado - sistema) * 100) / 100;
                    return (
                      <tr key={m} className={Math.abs(diff) >= 0.01 ? "cmv-alerta" : ""}>
                        <td>{METODO_LABEL[m]}</td>
                        <td>{money(sistema)}</td>
                        <td>
                          <input
                            type="number" inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={gaveta[m]}
                            onChange={(e) => setGaveta({ ...gaveta, [m]: e.target.value })}
                          />
                        </td>
                        <td>{money(diff)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Btn
                className="btn-primary"
                style={{ marginTop: 12 }}
                disabled={busy}
                onClick={() => run(() => api.conferirCaixa({ date: confDate, gaveta, operador: user?.email }), "Conferência gravada.")}
              >
                Fechar conferência
              </Btn>
            </div>
            <div className="card">
              <h3>Últimos fechamentos</h3>
              <table className="admin-table">
                <thead><tr><th>Dia</th><th>Sistema</th><th>Gaveta</th><th>Dif.</th></tr></thead>
                <tbody>
                  {(dash.fechamentos || []).map((row) => (
                    <tr key={row.id} className={row.ok ? "" : "cmv-alerta"}>
                      <td>{row.date}</td>
                      <td>{money(row.totalSistema)}</td>
                      <td>{money(row.totalGaveta)}</td>
                      <td>{money(row.diferenca)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === "contas" && gerente ? (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Nova conta a pagar</h3>
            <div className="form two">
              <label>Nome<input value={nova.name} onChange={(e) => setNova({ ...nova, name: e.target.value })} /></label>
              <label>Categoria
                <select value={nova.category} onChange={(e) => setNova({ ...nova, category: e.target.value })}>
                  {CATEGORIAS.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </label>
              <label>Tipo
                <select value={nova.type} onChange={(e) => setNova({ ...nova, type: e.target.value })}>
                  <option value="fixa">Fixa</option>
                  <option value="variavel">Variável</option>
                </select>
              </label>
              <label>Valor<input type="number" inputMode="decimal" min="0" step="0.01" value={nova.amount} onChange={(e) => setNova({ ...nova, amount: e.target.value })} /></label>
              <label>Vencimento<input type="date" value={nova.dueDate} onChange={(e) => setNova({ ...nova, dueDate: e.target.value })} /></label>
            </div>
            <Btn className="btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => run(() => api.createDespesa(nova), "Despesa lançada.")}>Lançar</Btn>
          </div>
          <div className="card">
            <div className="mobile-cards">
              {(dash.expenses || []).filter((item) => !search.trim() || String(item.name).toLowerCase().includes(search.trim().toLowerCase())).map((item) => (
                <article key={item.id} className="m-card">
                  <div className="m-card-head">
                    <InlineCell value={item.name} onSave={(v) => run(() => api.updateDespesa(item.id, { name: v }), "Salvo")} />
                    <div className="row-actions">
                      {item.status !== "pago" ? <Btn className="btn-gold" disabled={busy} onClick={() => run(() => api.pagarDespesa(item.id), "Paga.")}>Pagar</Btn> : null}
                      <Btn className="btn-ghost" disabled={busy} onClick={() => run(() => api.removeDespesa(item.id), "Removida.")}>Tirar</Btn>
                    </div>
                  </div>
                  <div className="m-card-grid">
                    <div className="m-meta">Categoria
                      <QuickSelect
                        value={item.category || "Fornecedores"}
                        options={CATEGORIAS.map((cat) => ({ value: cat, label: cat }))}
                        onSave={(v) => run(() => api.updateDespesa(item.id, { category: v }), "Salvo")}
                      />
                    </div>
                    <div className="m-meta">Tipo
                      <QuickSelect
                        value={item.type || "variavel"}
                        options={[{ value: "fixa", label: "Fixa" }, { value: "variavel", label: "Variável" }]}
                        onSave={(v) => run(() => api.updateDespesa(item.id, { type: v }), "Salvo")}
                      />
                    </div>
                    <div className="m-meta">Valor <b><InlineCell type="number" inputMode="decimal" step="0.01" value={item.amount} format={(v) => money(v)} onSave={(v) => run(() => api.updateDespesa(item.id, { amount: v }), "Salvo")} /></b></div>
                    <div className="m-meta">Venc. <b><InlineCell type="date" value={item.dueDate || ""} format={(v) => v || "—"} onSave={(v) => run(() => api.updateDespesa(item.id, { dueDate: v }), "Salvo")} /></b></div>
                    <div className="m-meta full">Status
                      <QuickSelect
                        value={item.status || "pendente"}
                        options={[{ value: "pendente", label: "Pendente" }, { value: "pago", label: "Pago" }, { value: "atrasado", label: "Atrasado" }]}
                        onSave={(v) => run(() => api.updateDespesa(item.id, { status: v }), "Salvo")}
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="admin-table-wrap desk-only">
            <table className="admin-table">
              <thead><tr><th>Nome</th><th>Categoria</th><th>Tipo</th><th>Valor</th><th>Venc.</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {(dash.expenses || []).filter((item) => !search.trim() || String(item.name).toLowerCase().includes(search.trim().toLowerCase())).map((item) => (
                  <tr key={item.id}>
                    <td><InlineCell value={item.name} onSave={(v) => run(() => api.updateDespesa(item.id, { name: v }), "Salvo")} /></td>
                    <td>
                      <QuickSelect
                        value={item.category || "Fornecedores"}
                        options={CATEGORIAS.map((cat) => ({ value: cat, label: cat }))}
                        onSave={(v) => run(() => api.updateDespesa(item.id, { category: v }), "Salvo")}
                      />
                    </td>
                    <td>
                      <QuickSelect
                        value={item.type || "variavel"}
                        options={[{ value: "fixa", label: "Fixa" }, { value: "variavel", label: "Variável" }]}
                        onSave={(v) => run(() => api.updateDespesa(item.id, { type: v }), "Salvo")}
                      />
                    </td>
                    <td><InlineCell type="number" inputMode="decimal" step="0.01" value={item.amount} format={(v) => money(v)} onSave={(v) => run(() => api.updateDespesa(item.id, { amount: v }), "Salvo")} /></td>
                    <td><InlineCell type="date" value={item.dueDate || ""} format={(v) => v || "—"} onSave={(v) => run(() => api.updateDespesa(item.id, { dueDate: v }), "Salvo")} /></td>
                    <td>
                      <QuickSelect
                        value={item.status || "pendente"}
                        options={[{ value: "pendente", label: "Pendente" }, { value: "pago", label: "Pago" }, { value: "atrasado", label: "Atrasado" }]}
                        onSave={(v) => run(() => api.updateDespesa(item.id, { status: v }), "Salvo")}
                      />
                    </td>
                    <td>
                      {item.status !== "pago" ? <Btn className="btn-gold" disabled={busy} onClick={() => run(() => api.pagarDespesa(item.id), "Paga.")}>Pagar</Btn> : null}
                      <Btn className="btn-ghost" disabled={busy} onClick={() => run(() => api.removeDespesa(item.id), "Removida.")}>Tirar</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === "receber" && gerente ? (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Conta a receber</h3>
            <div className="form two">
              <label>Cliente / origem<input value={receber.name} onChange={(e) => setReceber({ ...receber, name: e.target.value })} /></label>
              <label>Valor<input type="number" inputMode="decimal" min="0" step="0.01" value={receber.amount} onChange={(e) => setReceber({ ...receber, amount: e.target.value })} /></label>
              <label>Vencimento<input type="date" value={receber.dueDate} onChange={(e) => setReceber({ ...receber, dueDate: e.target.value })} /></label>
            </div>
            <Btn className="btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => run(() => api.createReceber(receber), "A receber lançado.")}>Lançar</Btn>
          </div>
          <div className="card">
            <div className="mobile-cards">
              {(dash.receivables || []).filter((item) => !search.trim() || String(item.name).toLowerCase().includes(search.trim().toLowerCase())).map((item) => (
                <article key={item.id} className="m-card">
                  <div className="m-card-head">
                    <InlineCell value={item.name} onSave={(v) => run(() => api.updateReceber(item.id, { name: v }), "Salvo")} />
                    {item.status !== "pago" ? <Btn className="btn-gold" disabled={busy} onClick={() => run(() => api.quitarReceber(item.id), "Recebido.")}>Quitar</Btn> : null}
                  </div>
                  <div className="m-card-grid">
                    <div className="m-meta">Valor <b><InlineCell type="number" inputMode="decimal" step="0.01" value={item.amount} format={(v) => money(v)} onSave={(v) => run(() => api.updateReceber(item.id, { amount: v }), "Salvo")} /></b></div>
                    <div className="m-meta">Venc. <b><InlineCell type="date" value={item.dueDate || ""} format={(v) => v || "—"} onSave={(v) => run(() => api.updateReceber(item.id, { dueDate: v }), "Salvo")} /></b></div>
                    <div className="m-meta full">Status
                      <QuickSelect
                        value={item.status || "pendente"}
                        options={[{ value: "pendente", label: "Pendente" }, { value: "pago", label: "Pago" }, { value: "atrasado", label: "Atrasado" }]}
                        onSave={(v) => run(() => api.updateReceber(item.id, { status: v }), "Salvo")}
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="admin-table-wrap desk-only">
            <table className="admin-table">
              <thead><tr><th>Nome</th><th>Valor</th><th>Venc.</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {(dash.receivables || []).filter((item) => !search.trim() || String(item.name).toLowerCase().includes(search.trim().toLowerCase())).map((item) => (
                  <tr key={item.id}>
                    <td><InlineCell value={item.name} onSave={(v) => run(() => api.updateReceber(item.id, { name: v }), "Salvo")} /></td>
                    <td><InlineCell type="number" inputMode="decimal" step="0.01" value={item.amount} format={(v) => money(v)} onSave={(v) => run(() => api.updateReceber(item.id, { amount: v }), "Salvo")} /></td>
                    <td><InlineCell type="date" value={item.dueDate || ""} format={(v) => v || "—"} onSave={(v) => run(() => api.updateReceber(item.id, { dueDate: v }), "Salvo")} /></td>
                    <td>
                      <QuickSelect
                        value={item.status || "pendente"}
                        options={[{ value: "pendente", label: "Pendente" }, { value: "pago", label: "Pago" }, { value: "atrasado", label: "Atrasado" }]}
                        onSave={(v) => run(() => api.updateReceber(item.id, { status: v }), "Salvo")}
                      />
                    </td>
                    <td>
                      {item.status !== "pago" ? <Btn className="btn-gold" disabled={busy} onClick={() => run(() => api.quitarReceber(item.id), "Recebido.")}>Quitar</Btn> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === "taxas" && gerente ? (
        <div className="card">
          <h3>Maquininha, voucher e DAS</h3>
          <div className="form two">
            {METODOS.map((m) => (
              <label key={m}>{METODO_LABEL[m]} (%)
                <input type="number" inputMode="decimal" min="0" step="0.01" value={taxas[m] ?? 0} onChange={(e) => setTaxas({ ...taxas, [m]: e.target.value })} />
              </label>
            ))}
            <label>Alíquota Simples Nacional (%)
              <input type="number" inputMode="decimal" min="0" step="0.1" value={imposto} onChange={(e) => setImposto(e.target.value)} />
            </label>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>Pix/débito/voucher D+1 · crédito D+30 · dinheiro na hora.</p>
          <Btn className="btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => run(() => api.updateTaxas({ taxas, impostoPercent: Number(imposto) }), "Taxas salvas.")}>Salvar</Btn>
        </div>
      ) : null}
    </main>
  );
}
