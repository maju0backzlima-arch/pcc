import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { errorMessage } from "../errors.js";
import { listaWhatsapp } from "../modules/estoque/cafeteria.js";
import { CMV_ALERTA, cmvProduto } from "../modules/financeiro/engine.js";

function money(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function qty(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

const TABS = [
  { id: "insumos", label: "Insumos" },
  { id: "ficha", label: "Ficha técnica" },
  { id: "perdas", label: "Perdas" },
  { id: "compra", label: "Entrada NF-e" },
  { id: "lista", label: "Lista de compras" }
];

export default function Estoque({ user }) {
  const [dash, setDash] = useState({ products: [], ingredients: [], listaCompras: { grupos: [], itens: [], estimado: 0, totalItens: 0 }, perdas: [] });
  const [tab, setTab] = useState("insumos");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [perda, setPerda] = useState({ insumoId: "", qty: 1, motivo: "Leite vencido" });
  const [xml, setXml] = useState("");
  const [nfe, setNfe] = useState(null);

  function apply(data) {
    setDash(data);
  }

  useEffect(() => {
    if (!user) return;
    api.estoqueProdutos().then(apply).catch((err) => setError(errorMessage(err)));
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  const insumos = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (dash.ingredients || []).filter((item) => {
      if (item.active === false) return false;
      if (!q) return true;
      return String(item.nome || item.name).toLowerCase().includes(q) || String(item.fornecedor || item.supplier || "").toLowerCase().includes(q);
    });
  }, [dash.ingredients, query]);

  const lista = dash.listaCompras || { grupos: [], itens: [], estimado: 0, totalItens: 0 };
  const baixos = insumos.filter((item) => Number(item.estoque_atual ?? item.stock) <= Number(item.estoque_minimo ?? item.minStock));

  async function run(task, ok) {
    setBusy(true);
    setError("");
    try {
      const data = await task();
      if (data?.products || data?.ingredients) apply(data);
      if (ok) setMessage(ok);
      return data;
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
          <p className="kicker">Cafeteria · Simples Nacional</p>
          <h2>Estoque vivo</h2>
        </div>
        <p>Baixa fracionada na ficha técnica. Perdas, NF-e e lista por fornecedor.</p>
      </div>

      {message ? <p className="ok">{message}</p> : null}
      {error ? <p className="err">{error}</p> : null}

      <div className="live-strip">
        <article className="pulse-card">
          <span className="steam" />
          <strong>{insumos.length}</strong>
          <small>insumos ativos</small>
        </article>
        <article className="pulse-card warn">
          <strong>{baixos.length}</strong>
          <small>abaixo do mínimo</small>
        </article>
        <article className="pulse-card">
          <strong>{lista.totalItens || 0}</strong>
          <small>itens na lista</small>
        </article>
        <article className="pulse-card gold">
          <strong>{money(lista.estimado)}</strong>
          <small>estimado de compra</small>
        </article>
      </div>

      <div className="cats">
        {TABS.map((item) => (
          <button key={item.id} className={`tab ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === "insumos" ? (
        <div className="card">
          <label style={{ maxWidth: 320, marginBottom: 14 }}>
            Buscar insumo
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome ou fornecedor" />
          </label>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Un.</th>
                  <th>Atual</th>
                  <th>Mín.</th>
                  <th>Ideal</th>
                  <th>Custo</th>
                  <th>Validade</th>
                  <th>Fornecedor</th>
                </tr>
              </thead>
              <tbody>
                {insumos.map((item) => {
                  const atual = Number(item.estoque_atual ?? item.stock);
                  const min = Number(item.estoque_minimo ?? item.minStock);
                  const pct = min > 0 ? Math.min(100, (atual / Number(item.estoque_ideal || min * 2 || 1)) * 100) : 100;
                  return (
                    <tr key={item.id}>
                      <td>
                        <b>{item.nome || item.name}</b>
                        <div className="stock-bar"><i style={{ width: `${pct}%` }} /></div>
                      </td>
                      <td>{item.unidade || item.unit}</td>
                      <td className={atual <= min ? "err" : ""}>{qty(atual)}</td>
                      <td>{qty(min)}</td>
                      <td>{qty(item.estoque_ideal ?? item.targetStock)}</td>
                      <td>{money(item.custo_unitario ?? item.costPerUnit)}</td>
                      <td>{item.validade || "—"}</td>
                      <td>{item.fornecedor || item.supplier}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "ficha" ? (
        <div className="shop-grid">
          {(dash.products || []).filter((p) => p.active !== false).map((product) => {
            const cmv = cmvProduto(product, dash.ingredients || []);
            return (
            <article key={product.id} className={`shop-card ${cmv.alerta ? "urgente" : ""}`}>
              <div className="shop-top">
                <span className={`prio ${product.tipo === "revenda" ? "atencao" : "planejado"}`}>
                  {product.tipo === "revenda" ? "Revenda CSOSN 500" : "Preparo CSOSN 102"}
                </span>
                <span className="muted">{money(product.preco_venda ?? product.price)}</span>
              </div>
              <b>{product.nome || product.name}</b>
              <p className={cmv.alerta ? "err" : "muted"}>
                CMV {money(cmv.cmv)} · {cmv.percent}%{cmv.alerta ? ` · acima de ${CMV_ALERTA}%` : ""}
              </p>
              <p className="muted">NCM {product.ncm || "—"} · CFOP {product.cfop || "5102"}</p>
              <ul className="ficha-list">
                {(product.fichaTecnica || product.recipe || []).map((row) => {
                  const ing = (dash.ingredients || []).find((i) => i.id === (row.insumo_id || row.ingredientId));
                  return (
                    <li key={row.insumo_id || row.ingredientId}>
                      {qty(row.quantidade_usada ?? row.qty)} {ing?.unidade || ing?.unit || ""} {ing?.nome || ing?.name || row.insumo_id}
                    </li>
                  );
                })}
              </ul>
            </article>
            );
          })}
        </div>
      ) : null}

      {tab === "perdas" ? (
        <div className="split">
          <div className="card">
            <h3>Lançar perda / quebra</h3>
            <div className="form">
              <label>
                Insumo
                <select value={perda.insumoId} onChange={(e) => setPerda({ ...perda, insumoId: e.target.value })}>
                  <option value="">Selecione</option>
                  {(dash.ingredients || []).map((item) => (
                    <option key={item.id} value={item.id}>{item.nome || item.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Quantidade
                <input type="number" min="0" step="0.01" value={perda.qty} onChange={(e) => setPerda({ ...perda, qty: e.target.value })} />
              </label>
              <label>
                Motivo
                <select value={perda.motivo} onChange={(e) => setPerda({ ...perda, motivo: e.target.value })}>
                  <option>Leite vencido</option>
                  <option>Regulagem de moedor</option>
                  <option>Quebra de copo / embalagem</option>
                  <option>Teste de receita</option>
                  <option>Outro</option>
                </select>
              </label>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => run(() => api.registrarPerda(perda), "Perda lançada e estoque atualizado.")}
              >
                Registrar perda
              </button>
            </div>
          </div>
          <div className="card">
            <h3>Histórico</h3>
            {(dash.perdas || []).length === 0 ? (
              <p className="muted">Nenhuma perda lançada.</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr><th>Quando</th><th>Item</th><th>Qtd</th><th>Motivo</th></tr>
                </thead>
                <tbody>
                  {(dash.perdas || []).slice(0, 20).map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.at).toLocaleString("pt-BR")}</td>
                      <td>{row.nome}</td>
                      <td>{qty(row.qty)} {row.unidade}</td>
                      <td>{row.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}

      {tab === "compra" ? (
        <div className="card">
          <h3>Entrada de compra (XML NF-e)</h3>
          <p className="muted">Cole o XML ou deixe em branco para usar o parser mock.</p>
          <textarea rows={6} value={xml} onChange={(e) => setXml(e.target.value)} placeholder="<nfeProc>..." />
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={async () => {
                const data = await run(() => api.parseNfe(xml));
                if (data?.itens) setNfe(data);
              }}
            >
              Ler XML
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !nfe}
              onClick={() => run(() => api.entradaCompra(nfe), "Estoque e custo médio atualizados.")}
            >
              Conferir e entrar no estoque
            </button>
          </div>
          {nfe ? (
            <div style={{ marginTop: 18 }}>
              <p><b>{nfe.emitente}</b> · NF {nfe.numero} {nfe.mock ? "· mock" : ""}</p>
              <table className="admin-table">
                <thead><tr><th>Item</th><th>Qtd</th><th>Custo</th></tr></thead>
                <tbody>
                  {nfe.itens.map((item, i) => (
                    <tr key={i}>
                      <td>{item.nome}</td>
                      <td>{qty(item.qty)} {item.unidade}</td>
                      <td>{money(item.custo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "lista" ? (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                className="btn btn-gold"
                onClick={() => {
                  const text = listaWhatsapp(lista);
                  navigator.clipboard?.writeText(text);
                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
                  setMessage("Lista copiada para o WhatsApp.");
                }}
              >
                Copiar para WhatsApp
              </button>
            </div>
          </div>
          {(lista.grupos || []).length === 0 ? (
            <div className="card"><p className="muted">Nenhum insumo abaixo do mínimo.</p></div>
          ) : (
            (lista.grupos || []).map((grupo) => (
              <div className="card" key={grupo.fornecedor} style={{ marginBottom: 12 }}>
                <h3>{grupo.fornecedor}</h3>
                <table className="admin-table">
                  <thead>
                    <tr><th>Insumo</th><th>Atual</th><th>Ideal</th><th>Comprar</th><th>Estimado</th></tr>
                  </thead>
                  <tbody>
                    {grupo.itens.map((item) => (
                      <tr key={item.id}>
                        <td>{item.nome}</td>
                        <td>{qty(item.estoque_atual)} {item.unidade}</td>
                        <td>{qty(item.estoque_ideal)}</td>
                        <td><b>{qty(item.quantidade_comprar)}</b></td>
                        <td>{money(item.estimado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </>
      ) : null}
    </main>
  );
}
