import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { errorMessage } from "../errors.js";
import { listaComprasCsv, listaComprasTexto } from "../modules/estoque/engine.js";

function money(value) {
  return (Number(value) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function qty(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

const empty = { products: [], listaCompras: { grupos: [], itens: [], estimado: 0, totalItens: 0 }, movements: [] };

export default function Estoque({ user }) {
  const [dash, setDash] = useState(empty);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [tab, setTab] = useState("produtos");

  function apply(data) {
    setDash(data);
    const next = {};
    (data.products || []).forEach((item) => {
      next[item.id] = {
        nome: item.nome || item.name,
        sku: item.sku,
        preco_custo: item.preco_custo ?? 0,
        preco_venda: item.preco_venda ?? item.price,
        estoque_atual: item.estoque_atual ?? item.available,
        estoque_minimo: item.estoque_minimo ?? 4,
        estoque_ideal: item.estoque_ideal ?? 12,
        fornecedor: item.fornecedor || ""
      };
    });
    setDrafts(next);
  }

  useEffect(() => {
    if (!user) return;
    api.estoqueProdutos().then(apply).catch((err) => setError(errorMessage(err)));
  }, [user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (dash.products || []).filter((item) => {
      if (item.active === false) return false;
      if (!q) return true;
      return (
        String(item.nome || item.name).toLowerCase().includes(q) ||
        String(item.sku || "").toLowerCase().includes(q) ||
        String(item.fornecedor || "").toLowerCase().includes(q)
      );
    });
  }, [dash.products, query]);

  const lista = dash.listaCompras || empty.listaCompras;

  if (!user) return <Navigate to="/login" replace />;

  async function save(id) {
    setBusy(true);
    setError("");
    try {
      const data = await api.updateEstoqueProduto(id, drafts[id]);
      apply(data);
      setMessage("Produto atualizado.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    const blob = new Blob([listaComprasCsv(lista)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lista-compras-picnic.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyWhatsapp() {
    const text = listaComprasTexto(lista);
    navigator.clipboard?.writeText(text);
    const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(wa, "_blank");
    setMessage("Lista copiada e aberta no WhatsApp.");
  }

  function printPdf() {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<pre style="font-family:Manrope,sans-serif;padding:24px">${listaComprasTexto(lista)}</pre>`);
    win.document.close();
    win.print();
  }

  return (
    <main className="page admin-page">
      <div className="section-head">
        <div>
          <p className="kicker">Módulo 1</p>
          <h2>Estoque e PDV+</h2>
        </div>
        <p>Cada venda no PDV+ baixa o estoque_atual e alimenta a lista de compras por fornecedor.</p>
      </div>

      {message ? <p className="ok">{message}</p> : null}
      {error ? <p className="err">{error}</p> : null}

      <div className="banners">
        <article className="banner wine">
          <strong>{filtered.length} produtos ativos</strong>
          <span>SKU, custo, venda, mínimo, ideal e fornecedor.</span>
        </article>
        <article className="banner gold">
          <strong>{lista.totalItens || 0} itens para comprar</strong>
          <span>Onde estoque_atual &le; estoque_minimo. Estimado {money(lista.estimado)}.</span>
        </article>
        <article className="banner">
          <strong>{(lista.grupos || []).length} fornecedores</strong>
          <span>Exporte CSV, PDF ou envie a lista no WhatsApp.</span>
        </article>
      </div>

      <div className="cats">
        <button className={`tab ${tab === "produtos" ? "active" : ""}`} onClick={() => setTab("produtos")}>
          Produtos
        </button>
        <button className={`tab ${tab === "compras" ? "active" : ""}`} onClick={() => setTab("compras")}>
          Lista de compras {lista.totalItens ? `(${lista.totalItens})` : ""}
        </button>
      </div>

      {tab === "produtos" ? (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <label style={{ minWidth: 240 }}>
              Buscar
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome, SKU ou fornecedor" />
            </label>
            <button className="btn btn-ghost" disabled={busy} onClick={() => api.estoqueProdutos().then(apply)}>
              Recarregar
            </button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th>Custo</th>
                  <th>Venda</th>
                  <th>Atual</th>
                  <th>Mínimo</th>
                  <th>Ideal</th>
                  <th>Fornecedor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const draft = drafts[item.id] || {};
                  const low = Number(draft.estoque_atual) <= Number(draft.estoque_minimo);
                  return (
                    <tr key={item.id}>
                      <td>
                        <input value={draft.nome || ""} onChange={(e) => setDrafts((c) => ({ ...c, [item.id]: { ...c[item.id], nome: e.target.value } }))} />
                      </td>
                      <td>
                        <input value={draft.sku || ""} onChange={(e) => setDrafts((c) => ({ ...c, [item.id]: { ...c[item.id], sku: e.target.value } }))} />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01" value={draft.preco_custo} onChange={(e) => setDrafts((c) => ({ ...c, [item.id]: { ...c[item.id], preco_custo: e.target.value } }))} />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01" value={draft.preco_venda} onChange={(e) => setDrafts((c) => ({ ...c, [item.id]: { ...c[item.id], preco_venda: e.target.value } }))} />
                      </td>
                      <td>
                        <input className={low ? "warn-input" : ""} type="number" min="0" value={draft.estoque_atual} onChange={(e) => setDrafts((c) => ({ ...c, [item.id]: { ...c[item.id], estoque_atual: e.target.value } }))} />
                      </td>
                      <td>
                        <input type="number" min="0" value={draft.estoque_minimo} onChange={(e) => setDrafts((c) => ({ ...c, [item.id]: { ...c[item.id], estoque_minimo: e.target.value } }))} />
                      </td>
                      <td>
                        <input type="number" min="0" value={draft.estoque_ideal} onChange={(e) => setDrafts((c) => ({ ...c, [item.id]: { ...c[item.id], estoque_ideal: e.target.value } }))} />
                      </td>
                      <td>
                        <input value={draft.fornecedor || ""} onChange={(e) => setDrafts((c) => ({ ...c, [item.id]: { ...c[item.id], fornecedor: e.target.value } }))} />
                      </td>
                      <td>
                        <button className="btn btn-primary" disabled={busy} onClick={() => save(item.id)}>
                          Salvar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "compras" ? (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={downloadCsv}>Exportar CSV</button>
              <button className="btn btn-ghost" onClick={printPdf}>Exportar PDF</button>
              <button className="btn btn-gold" onClick={copyWhatsapp}>Copiar / WhatsApp</button>
            </div>
          </div>
          {(lista.grupos || []).length === 0 ? (
            <div className="card">
              <p className="muted">Nenhum produto abaixo do mínimo. Estoque dentro da meta.</p>
            </div>
          ) : (
            (lista.grupos || []).map((grupo) => (
              <div className="card" key={grupo.fornecedor} style={{ marginBottom: 14 }}>
                <h3>{grupo.fornecedor}</h3>
                <p className="muted" style={{ marginTop: -8 }}>
                  {grupo.itens.length} itens · {money(grupo.total)}
                </p>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>SKU</th>
                      <th>Atual</th>
                      <th>Mín.</th>
                      <th>Ideal</th>
                      <th>Comprar</th>
                      <th>Estimado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.itens.map((item) => (
                      <tr key={item.id}>
                        <td>{item.nome}</td>
                        <td>{item.sku}</td>
                        <td>{qty(item.estoque_atual)}</td>
                        <td>{qty(item.estoque_minimo)}</td>
                        <td>{qty(item.estoque_ideal)}</td>
                        <td><strong>{qty(item.quantidade_comprar)}</strong></td>
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
