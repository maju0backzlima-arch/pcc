import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink } from "react-router-dom";
import { Radio, ShoppingCart, TriangleAlert, Wallet } from "lucide-react";
import { api } from "../api.js";
import { errorMessage } from "../errors.js";
import { CMV_ALERTA, cmvProduto } from "../modules/financeiro/engine.js";
import { canEditFicha, canSeeDre } from "../auth/permissoes.js";
import { Btn, ConfirmDel, Count, DupBtn, FornecedorSelect, InlineCell, QuickSelect, TabBtn, useToast } from "../ui/ui.jsx";

function money(value) {
  return (Number(value) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function when(value) {
  return value ? new Date(value).toLocaleString("pt-BR") : "ainda não";
}

function qty(value, unit = "") {
  const n = Number(value) || 0;
  const text = Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return unit ? `${text} ${unit}` : text;
}

const TABS = [
  { id: "lista", label: "Lista de mercado" },
  { id: "insumos", label: "Insumos" },
  { id: "cardapio", label: "Cardápio" },
  { id: "vendas", label: "Vendas PDV+" },
  { id: "ajustes", label: "Ajustes" },
  { id: "modulos", label: "Módulos" }
];

const emptyDash = {
  products: [],
  ingredients: [],
  shoppingList: [],
  shoppingSummary: { total: 0, urgente: 0, atencao: 0, planejado: 0, estimate: 0 },
  sales: [],
  purchases: [],
  settings: { shopping: {}, pdvAccount: {} }
};

function productDraft(item) {
  return {
    name: item.name,
    sku: item.sku,
    category: item.category,
    price: item.price,
    stock: item.available,
    active: item.active !== false,
    recipe: (item.recipe || []).map((row) => ({ ...row }))
  };
}

function ingredientDraft(item) {
  return {
    name: item.name,
    unit: item.unit,
    stock: item.stock,
    minStock: item.minStock,
    targetStock: item.targetStock,
    costPerUnit: item.costPerUnit,
    category: item.category,
    supplier: item.supplier,
    active: item.active !== false
  };
}

export default function Admin({ user, search = "" }) {
  const editaFicha = canEditFicha(user);
  const veDre = canSeeDre(user);
  const toast = useToast();
  const [dash, setDash] = useState(emptyDash);
  const [tab, setTab] = useState("lista");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("todos");
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [ingDrafts, setIngDrafts] = useState({});
  const [shopEdits, setShopEdits] = useState({});
  const [recipeOpen, setRecipeOpen] = useState("");
  const [highlightId, setHighlightId] = useState("");
  const [newShop, setNewShop] = useState({ name: "", buyQty: 1, unit: "un", supplier: "", notes: "" });
  const [newIng, setNewIng] = useState({
    name: "",
    unit: "un",
    stock: 0,
    minStock: 0,
    targetStock: 0,
    costPerUnit: 0,
    category: "Outros",
    supplier: ""
  });
  const [newProduct, setNewProduct] = useState({ name: "", sku: "", price: 0, category: "Outros" });
  const [salePick, setSalePick] = useState({ productId: "", qty: 1 });
  const [shopSettings, setShopSettings] = useState({
    autoGenerate: true,
    includeSoon: true,
    targetMultiplier: 2.5,
    soonFactor: 1.25
  });
  const [pdvSettings, setPdvSettings] = useState({ autoSync: true, simulateSales: true });
  const [account, setAccount] = useState({ name: "", password: "" });
  const settingsReady = useRef(false);
  const draftsRef = useRef({});
  const ingsRef = useRef({});
  const shopRef = useRef({});
  const liveRef = useRef(false);

  function applyDash(data, forceDrafts = false) {
    setDash(data);
    setDrafts((current) => {
      const next = { ...current };
      (data.products || []).forEach((item) => {
        if (forceDrafts || !next[item.id]) next[item.id] = productDraft(item);
      });
      draftsRef.current = next;
      return next;
    });
    setIngDrafts((current) => {
      const next = { ...current };
      (data.ingredients || []).forEach((item) => {
        if (forceDrafts || !next[item.id]) next[item.id] = ingredientDraft(item);
      });
      ingsRef.current = next;
      return next;
    });
    setShopEdits((current) => {
      const next = { ...current };
      (data.shoppingList || []).forEach((item) => {
        if (forceDrafts || !next[item.id]) {
          next[item.id] = { buyQty: item.buyQty, supplier: item.supplier || "", notes: item.notes || "" };
        } else if (!item.locked) {
          next[item.id] = { ...next[item.id], buyQty: item.buyQty };
        }
      });
      shopRef.current = next;
      return next;
    });
    if (!settingsReady.current && data.settings) {
      settingsReady.current = true;
      if (data.settings.shopping) {
        setShopSettings((current) => ({ ...current, ...data.settings.shopping }));
      }
      if (data.settings.pdvAccount) {
        setPdvSettings({
          autoSync: data.settings.pdvAccount.autoSync !== false,
          simulateSales: data.settings.pdvAccount.simulateSales !== false
        });
      }
    }
  }

  useEffect(() => {
    if (!user) return;
    api
      .dashboard()
      .then((data) => applyDash(data, true))
      .catch((err) => setError(errorMessage(err)));
    let source;
    try {
      source = new EventSource(api.streamUrl());
      source.onopen = () => {
        liveRef.current = true;
        setLive(true);
      };
      source.onerror = () => {
        liveRef.current = false;
        setLive(false);
      };
      const onData = (event) => {
        try {
          const data = JSON.parse(event.data);
          applyDash(data);
          if (data.lastSale) setLastSale(data.lastSale);
          liveRef.current = true;
          setLive(true);
        } catch {}
      };
      source.addEventListener("snapshot", onData);
      source.addEventListener("sale", onData);
      source.addEventListener("sync", onData);
      source.addEventListener("shopping", onData);
      source.addEventListener("products", onData);
      source.addEventListener("ingredients", onData);
      source.addEventListener("settings", onData);
    } catch {
      setLive(false);
    }
    const timer = setInterval(() => {
      api
        .dashboard()
        .then((data) => applyDash(data))
        .catch(() => {});
      if (!liveRef.current) {
        const sale = api.localTick?.();
        if (sale) {
          setLastSale(sale);
          api.dashboard().then((data) => applyDash(data)).catch(() => {});
        }
      }
    }, 12000);
    return () => {
      source?.close();
      clearInterval(timer);
    };
  }, [user]);

  useEffect(() => {
    if (user) setAccount({ name: user.name, password: "" });
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  async function run(task, okMessage, forceDrafts = false) {
    setBusy(true);
    setError("");
    try {
      const data = await task();
      if (data?.products) applyDash(data, forceDrafts);
      if (okMessage) toast(okMessage);
      return data || true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function changeDraft(id, patch) {
    setDrafts((current) => {
      const next = { ...current, [id]: { ...current[id], ...patch } };
      draftsRef.current = next;
      return next;
    });
  }

  function changeIng(id, patch) {
    setIngDrafts((current) => {
      const next = { ...current, [id]: { ...current[id], ...patch } };
      ingsRef.current = next;
      return next;
    });
  }

  function changeShop(id, patch) {
    setShopEdits((current) => {
      const next = { ...current, [id]: { ...current[id], ...patch } };
      shopRef.current = next;
      return next;
    });
  }

  async function saveShop(id) {
    const edit = shopRef.current[id];
    if (!edit) return;
    try {
      const data = await api.updateShoppingItem(id, edit);
      applyDash(data, true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function saveRecipe(item, recipe) {
    changeDraft(item.id, { recipe });
    const fichaTecnica = (recipe || []).map((row) => ({
      insumo_id: row.ingredientId || row.insumo_id,
      quantidade_usada: Number(row.qty ?? row.quantidade_usada ?? 0)
    }));
    run(() => api.updateProduct(item.id, { recipe, fichaTecnica }), "Salvo", true);
  }

  async function saveProduct(item) {
    const draft = draftsRef.current[item.id] || {};
    const payload = {
      name: draft.name,
      sku: draft.sku,
      category: draft.category,
      active: draft.active,
      recipe: draft.recipe
    };
    if (Number(draft.price) !== Number(item.price)) payload.price = draft.price;
    if (Number(draft.stock) !== Number(item.available)) payload.stock = draft.stock;
    return run(() => api.updateProduct(item.id, payload), `${draft.name} salvo.`, true);
  }

  const list = useMemo(() => {
    const q = (query || search).trim().toLowerCase();
    return (dash.shoppingList || []).filter((item) => {
      const matchQ =
        !q ||
        item.name.toLowerCase().includes(q) ||
        (item.supplier || "").toLowerCase().includes(q) ||
        (item.category || "").toLowerCase().includes(q);
      const matchP = priority === "todos" || item.priority === priority;
      return matchQ && matchP;
    });
  }, [dash.shoppingList, query, priority, search]);

  const summary = dash.shoppingSummary || emptyDash.shoppingSummary;

  return (
    <main className="page admin-page">
      <div className="section-head">
        <div>
          <p className="kicker">Uso interno da equipe</p>
          <h2>Central PIC NIC</h2>
        </div>
        <p>O PDV+ vende, o estoque cai e a lista de mercado se monta sozinha. Tudo aqui é editável.</p>
      </div>

      <div className="help">
        <b>Como usar este painel</b>
        <ol className="howto">
          <li>Cada venda no PDV+ desconta os insumos da receita na hora.</li>
          <li>Se o estoque ficar baixo, o item entra sozinho na lista, com prioridade e quantidade sugerida.</li>
          <li>Edite quantidade, fornecedor e recados, inclua item avulso ou marque como comprado.</li>
          <li>Ao marcar comprado, o estoque sobe e o cardápio volta a ficar disponível.</li>
        </ol>
      </div>

      <div className="bento">
        <article className="kpi-card">
          <span className="kpi-icon green"><Radio size={16} /></span>
          <span className="kpi-label">PDV+</span>
          <strong className="kpi-value">{live ? "Ao vivo" : "Offline"}</strong>
          <span className={`kpi-badge ${live ? "up" : "down"}`}>
            {lastSale ? when(lastSale.at) : when(dash.syncedAt)}
          </span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon red"><TriangleAlert size={16} /></span>
          <span className="kpi-label">Urgentes</span>
          <strong className="kpi-value"><Count value={summary.urgente} /></strong>
          <span className={`kpi-badge ${summary.urgente ? "down" : "up"}`}>Abaixo do mínimo</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon amber"><ShoppingCart size={16} /></span>
          <span className="kpi-label">Itens na lista</span>
          <strong className="kpi-value"><Count value={summary.total} /></strong>
          <span className="kpi-badge up">{summary.atencao} em atenção</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon brown"><Wallet size={16} /></span>
          <span className="kpi-label">Estimado</span>
          <strong className="kpi-value"><Count value={summary.estimate} money /></strong>
          <span className="kpi-badge up">{summary.planejado} planejados</span>
        </article>
      </div>
      <div className="bento-main">
        <div className="card">
          <h3>Última venda PDV+</h3>
          <p>
            {lastSale
              ? `${lastSale.items.map((item) => `${item.qty}x ${item.name}`).join(", ")} · ${when(lastSale.at)}${
                  lastSale.consumed?.length
                    ? ` · baixou ${lastSale.consumed.slice(0, 4).map((item) => `${item.name} ${qty(item.qty, item.unit)}`).join(", ")}`
                    : ""
                }`
              : `Última sincronização: ${when(dash.syncedAt)}`}
          </p>
        </div>
        <div className="card">
          <h3>Estoque crítico</h3>
          <ul className="alert-list">
            {(dash.shoppingList || []).filter((item) => item.priority === "urgente").slice(0, 5).map((item) => (
              <li className="alert-item" key={item.id}>
                <b>{item.name}</b>
                <span className="muted tabular">{qty(item.buyQty, item.unit)}</span>
              </li>
            ))}
            {(dash.shoppingList || []).filter((item) => item.priority === "urgente").length === 0 ? (
              <li className="muted">Nenhum insumo urgente.</li>
            ) : null}
          </ul>
        </div>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div className="cats">
        {TABS.map((item) => (
          <TabBtn key={item.id} active={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
            {item.id === "lista" && summary.urgente ? ` (${summary.urgente})` : ""}
          </TabBtn>
        ))}
      </div>

      {tab === "lista" ? (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label style={{ minWidth: 240 }}>
                Buscar na lista
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Insumo, fornecedor ou categoria"
                />
              </label>
              <label>
                Prioridade
                <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="todos">Todas</option>
                  <option value="urgente">Urgente</option>
                  <option value="atencao">Atenção</option>
                  <option value="planejado">Planejado</option>
                </select>
              </label>
              <Btn className="btn-ghost" disabled={busy} onClick={() => run(api.rebuildShopping, "Lista recalculada com o estoque atual.", true)}>
                Recalcular lista
              </Btn>
              <Btn className="btn-primary" disabled={busy} onClick={() => run(api.sync, "PDV+ sincronizado.", true)}>
                Sincronizar PDV+
              </Btn>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h3>Incluir item avulso</h3>
            <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
              Use para o que não está no estoque automático: gás, limpeza, extra de gelo.
            </p>
            <div className="form two">
              <label>
                O que comprar
                <input
                  value={newShop.name}
                  onChange={(e) => setNewShop({ ...newShop, name: e.target.value })}
                  placeholder="Ex.: Gás, guardanapo extra"
                />
              </label>
              <label>
                Quantidade
                <input type="number" inputMode="decimal" min="0" value={newShop.buyQty} onChange={(e) => setNewShop({ ...newShop, buyQty: e.target.value })} />
              </label>
              <label>
                Unidade
                <input value={newShop.unit} onChange={(e) => setNewShop({ ...newShop, unit: e.target.value })} />
              </label>
              <label>
                Fornecedor
                <input value={newShop.supplier} onChange={(e) => setNewShop({ ...newShop, supplier: e.target.value })} placeholder="Opcional" />
              </label>
            </div>
            <label style={{ marginTop: 12 }}>
              Observação
              <input
                value={newShop.notes}
                onChange={(e) => setNewShop({ ...newShop, notes: e.target.value })}
                placeholder="Onde comprar, marca, recado para a equipe"
              />
            </label>
            <Btn
              className="btn-gold"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={async () => {
                const ok = await run(
                  () => api.createShoppingItem(newShop),
                  "Item avulso adicionado. Ele fica até você marcar como comprado.",
                  true
                );
                if (ok) setNewShop({ name: "", buyQty: 1, unit: "un", supplier: "", notes: "" });
              }}
            >
              Adicionar na lista
            </Btn>
          </div>

          <div className="card">
            <h3>Compras sugeridas agora</h3>
            {list.length === 0 ? (
              <p className="muted">Nada para comprar neste filtro. O estoque está dentro da meta.</p>
            ) : (
              <div className="shop-grid">
                {list.map((item) => {
                  const edit = shopEdits[item.id] || { buyQty: item.buyQty, supplier: item.supplier || "", notes: item.notes || "" };
                  return (
                    <article key={item.id} className={`shop-card ${item.priority}`}>
                      <div className="shop-top">
                        <span className={`prio ${item.priority}`}>
                          {item.priority === "urgente" ? "Urgente" : item.priority === "atencao" ? "Atenção" : "Planejado"}
                        </span>
                        <span className="muted">{item.source === "auto" ? "Automático" : "Manual"}</span>
                      </div>
                      <b>{item.name}</b>
                      <p className="reason">{item.reason}</p>
                      <div className="shop-meta">
                        <span>Estoque: {qty(item.currentStock, item.unit)}</span>
                        <span>Mínimo: {qty(item.minStock, item.unit)}</span>
                        <span>Meta: {qty(item.targetStock, item.unit)}</span>
                      </div>
                      {item.usedIn?.length ? (
                        <p className="muted">
                          Afeta: {item.usedIn.slice(0, 4).join(", ")}
                          {item.usedIn.length > 4 ? "…" : ""}
                        </p>
                      ) : null}
                      <div className="row">
                        <label>
                          Comprar
                          <input
                            type="number" inputMode="decimal"
                            min="0"
                            value={edit.buyQty}
                            onChange={(e) => changeShop(item.id, { buyQty: e.target.value })}
                            onBlur={() => saveShop(item.id)}
                          />
                        </label>
                        <label>
                          Fornecedor
                          <input
                            value={edit.supplier}
                            onChange={(e) => changeShop(item.id, { supplier: e.target.value })}
                            onBlur={() => saveShop(item.id)}
                          />
                        </label>
                      </div>
                      <label>
                        Recado
                        <input
                          value={edit.notes}
                          onChange={(e) => changeShop(item.id, { notes: e.target.value })}
                          onBlur={() => saveShop(item.id)}
                          placeholder="Marca, ponto, quem compra"
                        />
                      </label>
                      <div className="shop-foot">
                        <strong>{money((Number(edit.buyQty) || 0) * (item.costPerUnit || 0))}</strong>
                        <div className="row">
                          <Btn
                            className="btn-gold"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => api.buyShoppingItem(item.id, { qty: edit.buyQty }),
                                `${item.name} marcado como comprado e estoque atualizado.`,
                                true
                              )
                            }
                          >
                            Marcar comprado
                          </Btn>
                          <Btn
                            className="btn-ghost"
                            disabled={busy}
                            onClick={() => run(() => api.removeShoppingItem(item.id), `${item.name} removido da lista.`, true)}
                          >
                            Tirar
                          </Btn>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}

      {tab === "insumos" ? (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>Novo insumo</h3>
            <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
              Cadastre o que entra na receita. Mínimo e meta definem quando o item aparece na lista.
            </p>
            <div className="form two">
              <label>
                Nome
                <input value={newIng.name} onChange={(e) => setNewIng({ ...newIng, name: e.target.value })} />
              </label>
              <label>
                Unidade
                <input value={newIng.unit} onChange={(e) => setNewIng({ ...newIng, unit: e.target.value })} />
              </label>
              <label>
                Estoque atual
                <input type="number" inputMode="decimal" min="0" value={newIng.stock} onChange={(e) => setNewIng({ ...newIng, stock: e.target.value })} />
              </label>
              <label>
                Estoque mínimo
                <input type="number" inputMode="decimal" min="0" value={newIng.minStock} onChange={(e) => setNewIng({ ...newIng, minStock: e.target.value })} />
              </label>
              <label>
                Meta de compra
                <input type="number" inputMode="decimal" min="0" value={newIng.targetStock} onChange={(e) => setNewIng({ ...newIng, targetStock: e.target.value })} />
              </label>
              <label>
                Custo por unidade
                <input type="number" inputMode="decimal" min="0" step="0.001" value={newIng.costPerUnit} onChange={(e) => setNewIng({ ...newIng, costPerUnit: e.target.value })} />
              </label>
              <label>
                Categoria
                <input value={newIng.category} onChange={(e) => setNewIng({ ...newIng, category: e.target.value })} />
              </label>
              <label>
                Fornecedor
                <FornecedorSelect
                  value={newIng.supplier}
                  list={dash.fornecedores || []}
                  onSave={(v) => setNewIng({ ...newIng, supplier: v, fornecedorId: v })}
                />
              </label>
            </div>
            <Btn
              className="btn-primary"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={() => run(() => api.createIngredient(newIng), "Insumo cadastrado. A lista passa a considerar este item.", true)}
            >
              Cadastrar insumo
            </Btn>
          </div>
          <div className="card">
            <h3>Estoque de insumos</h3>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Estoque</th>
                  <th>Mínimo</th>
                  <th>Meta</th>
                  <th>Custo</th>
                  <th>Fornecedor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                 {(dash.ingredients || []).map((item) => {
                  const low = Number(item.stock) <= Number(item.minStock);
                  return (
                    <tr key={item.id} className={highlightId === item.id ? "cmv-alerta" : ""}>
                      <td>
                        <InlineCell
                          value={item.name}
                          onSave={(v) => run(() => api.updateIngredient(item.id, { name: v }), `${v} atualizado.`, true)}
                        />
                        <div className="muted">
                          {item.category} · {item.unit}
                        </div>
                      </td>
                      <td>
                        <InlineCell
                          type="number" inputMode="decimal"
                          value={item.stock}
                          onSave={(v) => run(() => api.updateIngredient(item.id, { stock: v }), "Estoque atualizado.", true)}
                        />
                        {low ? <div className="err">Abaixo do mínimo</div> : null}
                      </td>
                      <td>
                        <InlineCell
                          type="number" inputMode="decimal"
                          value={item.minStock}
                          onSave={(v) => run(() => api.updateIngredient(item.id, { minStock: v }), "Mínimo atualizado.", true)}
                        />
                      </td>
                      <td>
                        <InlineCell
                          type="number" inputMode="decimal"
                          value={item.targetStock}
                          onSave={(v) => run(() => api.updateIngredient(item.id, { targetStock: v }), "Ideal atualizado.", true)}
                        />
                      </td>
                      <td>
                        <InlineCell
                          type="number" inputMode="decimal"
                          step="0.001"
                          value={item.costPerUnit}
                          format={(v) => money(v)}
                          onSave={(v) => run(() => api.updateIngredient(item.id, { costPerUnit: v }), "Custo atualizado.", true)}
                        />
                      </td>
                      <td>
                        <FornecedorSelect
                          value={item.fornecedorId || item.supplier}
                          list={dash.fornecedores || []}
                          onSave={(v) => run(() => api.updateIngredient(item.id, { fornecedorId: v }), "Fornecedor vinculado.", true)}
                        />
                      </td>
                      <td>
                        <div className="row-actions">
                          <DupBtn onClick={async () => {
                            const data = await run(() => api.cloneIngredient(item.id), "Cópia criada", true);
                            if (data?.clonedId) setHighlightId(data.clonedId);
                          }} />
                          <ConfirmDel onConfirm={() => run(() => api.deleteIngredient(item.id), "Insumo excluído", true)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "cardapio" ? (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>Novo item do cardápio</h3>
            <div className="form two">
              <label>
                Nome
                <input value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} />
              </label>
              <label>
                SKU
                <input value={newProduct.sku} onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })} />
              </label>
              <label>
                Preço
                <input type="number" inputMode="decimal" min="0" step="0.01" value={newProduct.price} onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })} />
              </label>
              <label>
                Categoria
                <input value={newProduct.category} onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })} />
              </label>
            </div>
            <Btn
              className="btn-primary"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={() => run(() => api.createProduct(newProduct), "Produto criado. Depois ligue a receita nos insumos.", true)}
            >
              Criar produto
            </Btn>
          </div>
          <div className="card">
            <h3>Preço, estoque, visibilidade e receita</h3>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>PDV+</th>
                  <th>Preço no site</th>
                  <th>CMV</th>
                  <th>Estoque</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(dash.products || []).map((item) => {
                  const draft = drafts[item.id] || productDraft(item);
                  const cmv = cmvProduto(item, dash.ingredients || []);
                  return (
                    <Fragment key={item.id}>
                       <tr className={`${cmv.alerta || highlightId === item.id ? "cmv-alerta" : ""} ${item.active === false ? "off-row" : ""}`}>
                        <td>
                          <InlineCell
                            value={draft.name}
                            onSave={(v) => {
                              changeDraft(item.id, { name: v });
                              run(() => api.updateProduct(item.id, { name: v, nome: v }), "Salvo", true);
                            }}
                          />
                          <div className="muted">{item.category} · {item.sku}</div>
                          <div className="row" style={{ marginTop: 6 }}>
                            <QuickSelect
                              value={item.tipo || "preparo"}
                              options={[{ value: "preparo", label: "Preparo 102" }, { value: "revenda", label: "Revenda 500" }]}
                              onSave={(v) => run(() => api.updateProduct(item.id, { tipo: v, csosn: v === "revenda" ? "500" : "102" }), "Salvo", true)}
                            />
                          </div>
                          <div className="row" style={{ marginTop: 6 }}>
                            <InlineCell value={item.ncm || ""} format={(v) => `NCM ${v || "—"}`} onSave={(v) => run(() => api.updateProduct(item.id, { ncm: v }), "Salvo", true)} />
                            <InlineCell value={item.cfop || "5102"} format={(v) => `CFOP ${v}`} onSave={(v) => run(() => api.updateProduct(item.id, { cfop: v }), "Salvo", true)} />
                            <InlineCell value={item.csosn || ""} format={(v) => `CSOSN ${v || "—"}`} onSave={(v) => run(() => api.updateProduct(item.id, { csosn: v }), "Salvo", true)} />
                          </div>
                        </td>
                        <td>
                          {money(item.lastPdvPrice ?? item.price)}
                          <div className="muted">{item.lastPdvStock ?? item.available} un.</div>
                        </td>
                        <td>
                          <InlineCell
                            type="number" inputMode="decimal"
                            step="0.01"
                            value={draft.price}
                            format={(v) => money(v)}
                            onSave={(v) => {
                              changeDraft(item.id, { price: v });
                              run(() => api.updateProduct(item.id, { price: v }), "Preço atualizado.", true);
                            }}
                          />
                          {item.priceOverride != null ? (
                            <Btn className="btn-ghost" style={{ marginTop: 6 }} onClick={() => run(() => api.updateProduct(item.id, { clearPrice: true }), "Preço voltou para o PDV+.", true)}>
                              Usar PDV+
                            </Btn>
                          ) : null}
                        </td>
                        <td>
                          <span className={`pill cmv-pill ${cmv.alerta ? "alerta" : ""}`}>
                            <Count value={cmv.percent} digits={1} />%
                          </span>
                          <div className="muted tabular">{money(cmv.cmv)}{cmv.alerta ? ` · >${CMV_ALERTA}%` : ""}</div>
                        </td>
                        <td>
                          <InlineCell
                            type="number" inputMode="decimal"
                            value={draft.stock}
                            onSave={(v) => {
                              changeDraft(item.id, { stock: v });
                              run(() => api.updateProduct(item.id, { stock: v }), "Estoque atualizado.", true);
                            }}
                          />
                          {item.stockOverride != null ? (
                            <Btn className="btn-ghost" style={{ marginTop: 6 }} onClick={() => run(() => api.updateProduct(item.id, { clearStock: true }), "Estoque voltou para o PDV+.", true)}>
                              Usar PDV+
                            </Btn>
                          ) : null}
                        </td>
                        <td>
                          <div className="row-actions">
                            <Btn className="btn-gold" disabled={busy} onClick={() => saveProduct(item)}>
                              Salvar
                            </Btn>
                            <Btn
                              className="btn-ghost"
                              disabled={busy}
                              onClick={() => run(() => api.updateProduct(item.id, { active: item.active === false }), item.active === false ? "Produto reativado." : "Produto ocultado.", true)}
                            >
                              {item.active === false ? "Ativar" : "Ocultar"}
                            </Btn>
                            {editaFicha ? (
                            <Btn className="btn-ghost" onClick={() => setRecipeOpen(recipeOpen === item.id ? "" : item.id)}>
                              Receita
                            </Btn>
                            ) : null}
                            <DupBtn onClick={async () => {
                              const data = await run(() => api.cloneProduct(item.id), "Cópia criada", true);
                              if (data?.clonedId) {
                                setHighlightId(data.clonedId);
                                setRecipeOpen(data.clonedId);
                              }
                            }} />
                            <ConfirmDel onConfirm={() => run(() => api.deleteProduct(item.id), "Produto excluído", true)} />
                          </div>
                        </td>
                      </tr>
                      {recipeOpen === item.id ? (
                        <tr>
                          <td colSpan={6}>
                            <div className="recipe-box">
                              <p className="muted">A receita diz o que cada venda do PDV+ consome. Sem insumo, o item some do cardápio e entra na lista.</p>
                              {(draft.recipe || []).map((row, index) => (
                                <div className="row recipe-row" key={`${item.id}-${index}`}>
                                  <select
                                    value={row.ingredientId}
                                    onChange={(e) => {
                                      const recipe = draft.recipe.map((entry, i) => (i === index ? { ...entry, ingredientId: e.target.value } : entry));
                                      saveRecipe(item, recipe);
                                    }}
                                  >
                                    {(dash.ingredients || []).map((ing) => (
                                      <option key={ing.id} value={ing.id}>
                                        {ing.name} ({ing.unit})
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="number" inputMode="decimal"
                                    min="0"
                                    step="0.01"
                                    value={row.qty}
                                    onChange={(e) => {
                                      const recipe = draft.recipe.map((entry, i) => (i === index ? { ...entry, qty: Number(e.target.value) } : entry));
                                      changeDraft(item.id, { recipe });
                                    }}
                                    onBlur={(e) => {
                                      const recipe = draft.recipe.map((entry, i) => (i === index ? { ...entry, qty: Number(e.target.value) } : entry));
                                      saveRecipe(item, recipe);
                                    }}
                                  />
                                  <Btn
                                    className="btn-ghost"
                                    onClick={() => saveRecipe(item, draft.recipe.filter((_, i) => i !== index))}
                                  >
                                    Tirar
                                  </Btn>
                                </div>
                              ))}
                              <Btn
                                className="btn-ghost"
                                onClick={() =>
                                  saveRecipe(item, [...(draft.recipe || []), { ingredientId: dash.ingredients[0]?.id || "", qty: 1 }])
                                }
                              >
                                Incluir insumo na receita
                              </Btn>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "vendas" ? (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>Lançar venda (se o PDV+ não mandou)</h3>
            <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
              Consome a receita, baixa o estoque e atualiza a lista na hora, igual uma venda do caixa.
            </p>
            <div className="row">
              <label style={{ minWidth: 280 }}>
                Produto
                <select value={salePick.productId} onChange={(e) => setSalePick({ ...salePick, productId: e.target.value })}>
                  <option value="">Escolha</option>
                  {(dash.products || [])
                    .filter((item) => item.active !== false)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.available} un.
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Quantidade
                <input type="number" inputMode="decimal" min="1" value={salePick.qty} onChange={(e) => setSalePick({ ...salePick, qty: e.target.value })} />
              </label>
              <Btn
                className="btn-primary"
                disabled={busy || !salePick.productId}
                onClick={() =>
                  run(
                    () => api.registerSale({ items: [{ productId: salePick.productId, qty: Number(salePick.qty) || 1 }] }),
                    "Venda lançada. Veja a lista se algum insumo ficou crítico.",
                    true
                  )
                }
              >
                Registrar venda
              </Btn>
            </div>
          </div>
          <div className="split">
            <div className="card">
              <h3>Últimas vendas</h3>
              {(dash.sales || []).length === 0 ? (
                <p className="muted">Nenhuma venda ainda. O PDV+ simulado lança sozinho a cada poucos segundos.</p>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Itens</th>
                      <th>Origem</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dash.sales || []).map((sale) => (
                      <tr key={sale.id}>
                        <td>{when(sale.at)}</td>
                        <td>{sale.items.map((item) => `${item.qty}x ${item.name}`).join(", ")}</td>
                        <td>{sale.source === "pdvplus" ? "PDV+" : "Manual"}</td>
                        <td>{money(sale.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card">
              <h3>Compras recentes</h3>
              {(dash.purchases || []).length === 0 ? (
                <p className="muted">Nada marcado como comprado ainda.</p>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Item</th>
                      <th>Qtd</th>
                      <th>Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dash.purchases || []).map((buy) => (
                      <tr key={buy.id}>
                        <td>{when(buy.at)}</td>
                        <td>{buy.name}</td>
                        <td>{qty(buy.qty, buy.unit)}</td>
                        <td>{money(buy.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : null}

      {tab === "ajustes" ? (
        <div className="split">
          <div className="card">
            <h3>Regras da lista de mercado</h3>
            <p className="muted" style={{ marginTop: -8 }}>
              A lista nasce sozinha quando o estoque cai. Ajuste a sensibilidade sem mexer em código.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={shopSettings.autoGenerate !== false}
                onChange={(e) => setShopSettings({ ...shopSettings, autoGenerate: e.target.checked })}
              />
              Montar a lista automaticamente a cada venda
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={shopSettings.includeSoon !== false}
                onChange={(e) => setShopSettings({ ...shopSettings, includeSoon: e.target.checked })}
              />
              Incluir itens que ainda não acabaram, mas já estão perto do mínimo
            </label>
            <label>
              Meta de estoque (múltiplo do mínimo)
              <input
                type="number" inputMode="decimal"
                min="1"
                step="0.1"
                value={shopSettings.targetMultiplier}
                onChange={(e) => setShopSettings({ ...shopSettings, targetMultiplier: e.target.value })}
              />
            </label>
            <Btn className="btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => run(() => api.updateSettings({ shopping: shopSettings }), "Regras da lista salvas.")}>
              Salvar regras
            </Btn>
          </div>
          <div className="card">
            <h3>PDV+ e acesso</h3>
            <label className="check">
              <input type="checkbox" checked={pdvSettings.autoSync} onChange={(e) => setPdvSettings({ ...pdvSettings, autoSync: e.target.checked })} />
              Sincronizar sozinho com o PDV+
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={pdvSettings.simulateSales}
                onChange={(e) => setPdvSettings({ ...pdvSettings, simulateSales: e.target.checked })}
              />
              Simular vendas do caixa (útil para treinar a equipe)
            </label>
            <Btn className="btn-gold" style={{ marginTop: 8 }} disabled={busy} onClick={() => run(() => api.updateSettings({ pdvAccount: pdvSettings }), "Ajustes do PDV+ salvos.")}>
              Salvar PDV+
            </Btn>
            <hr className="soft" />
            <label>
              Nome do lojista
              <input value={account.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} />
            </label>
            <label>
              Nova senha
              <input
                type="password"
                value={account.password}
                onChange={(e) => setAccount({ ...account, password: e.target.value })}
                placeholder="Deixe em branco para não mudar"
              />
            </label>
            <Btn className="btn-ghost" style={{ marginTop: 12 }} disabled={busy} onClick={() => run(() => api.updateUser(account), "Dados de acesso atualizados.")}>
              Salvar acesso
            </Btn>
          </div>
        </div>
      ) : null}

      {tab === "modulos" ? (
        <div className="split">
          <div className="card">
            <h3>Estoque e PDV+</h3>
            <p className="muted">Produtos com estoque_atual, mínimo, ideal e lista de compras por fornecedor.</p>
            <NavLink className="btn btn-primary" to="/estoque" style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}>
              Abrir estoque
            </NavLink>
          </div>
          <div className="card">
            <h3>{veDre ? "Financeiro e DRE" : "Caixa"}</h3>
            <p className="muted">Pix, crédito, débito, voucher, dinheiro, conferência de gaveta e NFC-e.</p>
            <NavLink className="btn btn-gold" to="/financeiro" style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}>
              Abrir {veDre ? "financeiro" : "caixa"}
            </NavLink>
            <NavLink className="btn btn-primary" to="/notas" style={{ display: "inline-block", marginTop: 12, marginLeft: 8, textDecoration: "none" }}>
              Notas fiscais
            </NavLink>
          </div>
        </div>
      ) : null}
    </main>
  );
}
