import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";

function money(value) {
  return (Number(value) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Admin({ user }) {
  const [items, setItems] = useState([]);
  const [syncedAt, setSyncedAt] = useState(null);
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api.adminProducts();
    setItems(data.products);
    setSyncedAt(data.syncedAt);
    setConnected(data.connected);
    const next = {};
    data.products.forEach((item) => {
      next[item.id] = { price: item.price, stock: item.available };
    });
    setDrafts(next);
  }

  useEffect(() => {
    if (!user) return;
    load().catch((err) => setError(err.message));
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q)
    );
  }, [items, query]);

  async function syncNow() {
    setBusy(true);
    setError("");
    try {
      const data = await api.sync();
      setItems(data.products);
      setSyncedAt(data.sync.at);
      setMessage(`PDV+ atualizado: ${data.sync.updated} itens sincronizados.`);
      const next = {};
      data.products.forEach((item) => {
        next[item.id] = { price: item.price, stock: item.available };
      });
      setDrafts(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(id, extra = {}) {
    setError("");
    const draft = drafts[id] || {};
    try {
      const updated = await api.updateProduct(id, {
        price: draft.price,
        stock: draft.stock,
        ...extra
      });
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...updated } : item)));
      setDrafts((current) => ({
        ...current,
        [id]: { price: updated.price, stock: updated.available }
      }));
      setMessage(`${updated.name} atualizado no site.`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <div className="section-head">
        <div>
          <p className="kicker">Controle extra</p>
          <h2>Painel do lojista</h2>
        </div>
        <p>Altere preço e estoque na hora, sem esperar o próximo ciclo do PDV+.</p>
      </div>

      <div className="banners">
        <article className="banner wine">
          <strong>
            <span className={`status-dot ${connected ? "on" : ""}`} />
            {connected ? "PDV+ conectado" : "PDV+ aguardando sync"}
          </strong>
          <span>
            {syncedAt
              ? `Última busca automática: ${new Date(syncedAt).toLocaleString("pt-BR")}`
              : "Faça login novamente para forçar uma nova leitura."}
          </span>
        </article>
        <article className="banner">
          <strong>Ajuste manual prevalece</strong>
          <span>Se você gravar um valor aqui, o site usa esse número até você devolver o item ao PDV+.</span>
        </article>
        <article className="banner gold">
          <strong>Sincronize quando o caixa mudar</strong>
          <span>Um clique busca preço e quantidade atuais da maquininha / base PDV+.</span>
        </article>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ minWidth: 260 }}>
            Buscar produto
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome, SKU ou categoria" />
          </label>
          <button className="btn btn-primary" onClick={syncNow} disabled={busy}>
            {busy ? "Sincronizando..." : "Sincronizar PDV+ agora"}
          </button>
        </div>
        {message ? <p className="ok" style={{ marginTop: 12 }}>{message}</p> : null}
        {error ? <p className="err" style={{ marginTop: 12 }}>{error}</p> : null}
      </div>

      <div className="card">
        <h3>Preço e estoque</h3>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>PDV+</th>
              <th>Preço no site</th>
              <th>Estoque no site</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const draft = drafts[item.id] || { price: item.price, stock: item.available };
              return (
                <tr key={item.id}>
                  <td>
                    <b>{item.name}</b>
                    <div className="muted">{item.category}</div>
                  </td>
                  <td>
                    {money(item.lastPdvPrice ?? item.price)}
                    <div className="muted">{item.lastPdvStock ?? item.available} un.</div>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.price}
                      onChange={(e) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.id]: { ...draft, price: e.target.value }
                        }))
                      }
                    />
                    {item.priceOverride != null ? (
                      <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => saveItem(item.id, { clearPrice: true })}>
                        Usar PDV+
                      </button>
                    ) : null}
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={draft.stock}
                      onChange={(e) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.id]: { ...draft, stock: e.target.value }
                        }))
                      }
                    />
                    {item.stockOverride != null ? (
                      <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => saveItem(item.id, { clearStock: true })}>
                        Usar PDV+
                      </button>
                    ) : null}
                  </td>
                  <td>
                    <button className="btn btn-gold" onClick={() => saveItem(item.id)}>
                      Salvar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
