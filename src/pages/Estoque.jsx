import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { AlertTriangle, Package, ShoppingCart, TriangleAlert, Wallet } from "lucide-react";
import { api } from "../api.js";
import { errorMessage } from "../errors.js";
import { listaWhatsappGrupo, vencendoEm, waDigits } from "../modules/estoque/cafeteria.js";
import { CMV_ALERTA, cmvProduto } from "../modules/financeiro/engine.js";
import { Btn, Chip, ConfirmDel, Count, DupBtn, FadeTab, FornecedorSelect, InlineCell, Modal, QuickSelect, TabBtn, useToast } from "../ui/ui.jsx";

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
  { id: "fornecedores", label: "Fornecedores" },
  { id: "perdas", label: "Perdas" },
  { id: "compra", label: "Entrada NF-e" },
  { id: "lista", label: "Lista de compras" }
];

export default function Estoque({ user, search = "" }) {
  const toast = useToast();
  const [dash, setDash] = useState({ products: [], ingredients: [], fornecedores: [], listaCompras: { grupos: [], itens: [], estimado: 0, totalItens: 0 }, perdas: [] });
  const [tab, setTab] = useState("insumos");
  const [query, setQuery] = useState("");
  const [prodQuery, setProdQuery] = useState("");
  const globalQ = search;
  const [filter, setFilter] = useState("todos");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [perdaOpen, setPerdaOpen] = useState(false);
  const [highlightId, setHighlightId] = useState("");
  const [fichaOpen, setFichaOpen] = useState("");
  const [perda, setPerda] = useState({ insumoId: "", qty: 1, motivo: "Vencido" });
  const [xml, setXml] = useState("");
  const [nfe, setNfe] = useState(null);
  const [fornOpen, setFornOpen] = useState(false);
  const [fornDraft, setFornDraft] = useState({ name: "", whatsapp: "", categoria: "Geral", prazoDias: 2 });
  const [editForn, setEditForn] = useState(null);

  function apply(data) {
    setDash(data);
  }

  useEffect(() => {
    if (!user) return;
    api.estoqueProdutos().then(apply).catch((err) => setError(errorMessage(err)));
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  const insumos = useMemo(() => {
    const q = (query || globalQ).trim().toLowerCase();
    return (dash.ingredients || []).filter((item) => {
      if (item.active === false) return false;
      const atual = Number(item.estoque_atual ?? item.stock);
      const min = Number(item.estoque_minimo ?? item.minStock);
      if (filter === "critico" && atual > min) return false;
      if (filter === "vencendo" && !vencendoEm(item, 3)) return false;
      if (!q) return true;
      return String(item.nome || item.name).toLowerCase().includes(q) || String(item.fornecedor || item.supplier || "").toLowerCase().includes(q);
    });
  }, [dash.ingredients, query, filter, globalQ]);

  const produtos = useMemo(() => {
    const q = (prodQuery || globalQ).trim().toLowerCase();
    return (dash.products || []).filter((p) => {
      if (p.active === false) return false;
      const cmv = cmvProduto(p, dash.ingredients || []);
      if (filter === "margem" && !cmv.alerta) return false;
      if (!q) return true;
      return String(p.nome || p.name).toLowerCase().includes(q) || String(p.ncm || "").includes(q);
    });
  }, [dash.products, dash.ingredients, prodQuery, filter, globalQ]);

  const lista = dash.listaCompras || { grupos: [], itens: [], estimado: 0, totalItens: 0 };
  const baixos = insumos.filter((item) => Number(item.estoque_atual ?? item.stock) <= Number(item.estoque_minimo ?? item.minStock));
  const fornecedores = dash.fornecedores || [];

  async function run(task, ok) {
    setBusy(true);
    setError("");
    try {
      const data = await task();
      if (data?.products || data?.ingredients || data?.fornecedores) apply(data);
      if (ok) toast(ok);
      return data;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function patchIng(id, payload) {
    return run(() => api.updateIngredient(id, payload), "Salvo");
  }
  function patchProd(id, payload) {
    return run(() => api.updateProduct(id, payload), "Salvo");
  }
  async function duplicarIng(id) {
    const data = await run(() => api.cloneIngredient(id), "Cópia criada");
    if (data?.clonedId) setHighlightId(data.clonedId);
  }
  async function duplicarProd(id) {
    const data = await run(() => api.cloneProduct(id), "Cópia criada");
    if (data?.clonedId) {
      setHighlightId(data.clonedId);
      setFichaOpen(data.clonedId);
    }
  }

  return (
    <main className="page admin-page">
      <div className="section-head">
        <div>
          <p className="kicker">Cafeteria · Simples Nacional</p>
          <h2>Estoque vivo</h2>
        </div>
        <p>Clique no número para editar. CMV recalcula na hora.</p>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div className="bento">
        <article className="kpi-card">
          <span className="kpi-icon brown"><Package size={16} /></span>
          <span className="kpi-label">Insumos ativos</span>
          <strong className="kpi-value"><Count value={insumos.length} /></strong>
          <span className="kpi-badge up">Cadastro vivo</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon red"><TriangleAlert size={16} /></span>
          <span className="kpi-label">Abaixo do mínimo</span>
          <strong className="kpi-value"><Count value={baixos.length} /></strong>
          <span className={`kpi-badge ${baixos.length ? "down" : "up"}`}>{baixos.length ? "Crítico" : "Ok"}</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon amber"><ShoppingCart size={16} /></span>
          <span className="kpi-label">Itens na lista</span>
          <strong className="kpi-value"><Count value={lista.totalItens || 0} /></strong>
          <span className="kpi-badge up">Compra sugerida</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon green"><Wallet size={16} /></span>
          <span className="kpi-label">Estimado de compra</span>
          <strong className="kpi-value"><Count value={lista.estimado} money /></strong>
          <span className="kpi-badge up">Fornecedores</span>
        </article>
      </div>

      <div className="cats">
        {TABS.map((item) => (
          <TabBtn key={item.id} active={tab === item.id} onClick={() => { setTab(item.id); setFilter("todos"); }}>
            {item.label}
          </TabBtn>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "insumos" ? (
          <FadeTab id="insumos">
            <div className="card">
              <div className="filter-row">
                <label style={{ minWidth: 240, margin: 0 }}>
                  Buscar
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome ou fornecedor" />
                </label>
                <Chip active={filter === "todos"} onClick={() => setFilter("todos")}>Todos</Chip>
                <Chip active={filter === "critico"} onClick={() => setFilter("critico")}>Estoque crítico</Chip>
                <Chip active={filter === "vencendo"} onClick={() => setFilter("vencendo")}>Vencendo em 3 dias</Chip>
              </div>
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
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {insumos.map((item) => {
                      const atual = Number(item.estoque_atual ?? item.stock);
                      const min = Number(item.estoque_minimo ?? item.minStock);
                      const pct = min > 0 ? Math.min(100, (atual / Number(item.estoque_ideal || min * 2 || 1)) * 100) : 100;
                      return (
                        <tr key={item.id} className={highlightId === item.id ? "cmv-alerta" : ""}>
                          <td>
                            <InlineCell value={item.nome || item.name} onSave={(v) => patchIng(item.id, { name: v, nome: v })} />
                            <div className="stock-bar"><i style={{ width: `${pct}%` }} /></div>
                          </td>
                          <td>
                            <InlineCell value={item.unidade || item.unit} onSave={(v) => patchIng(item.id, { unit: v, unidade: v })} />
                          </td>
                          <td className={atual <= min ? "err" : ""}>
                            <InlineCell type="number" step="0.01" value={atual} format={(v) => qty(v)} onSave={(v) => patchIng(item.id, { stock: v, estoque_atual: v })} />
                          </td>
                          <td>
                            <InlineCell type="number" step="0.01" value={min} format={(v) => qty(v)} onSave={(v) => patchIng(item.id, { minStock: v, estoque_minimo: v })} />
                          </td>
                          <td>
                            <InlineCell type="number" step="0.01" value={item.estoque_ideal ?? item.targetStock} format={(v) => qty(v)} onSave={(v) => patchIng(item.id, { targetStock: v, estoque_ideal: v })} />
                          </td>
                          <td>
                            <InlineCell type="number" step="0.001" value={item.custo_unitario ?? item.costPerUnit} format={(v) => money(v)} onSave={(v) => patchIng(item.id, { costPerUnit: v, custo_unitario: v })} />
                          </td>
                          <td>
                            <InlineCell type="date" value={item.validade || ""} format={(v) => v || "—"} onSave={(v) => patchIng(item.id, { validade: v })} />
                          </td>
                          <td>
                            <FornecedorSelect value={item.fornecedorId || item.fornecedor || item.supplier} list={fornecedores} onSave={(v) => patchIng(item.id, { fornecedorId: v })} />
                          </td>
                          <td>
                            <div className="row-actions">
                              <DupBtn onClick={() => duplicarIng(item.id)} />
                              <ConfirmDel onConfirm={() => run(() => api.deleteIngredient(item.id), "Insumo excluído")} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </FadeTab>
        ) : null}

        {tab === "ficha" ? (
          <FadeTab id="ficha">
            <div className="filter-row">
              <label style={{ minWidth: 240, margin: 0 }}>
                Buscar produto
                <input value={prodQuery} onChange={(e) => setProdQuery(e.target.value)} placeholder="Nome ou NCM" />
              </label>
              <Chip active={filter === "todos"} onClick={() => setFilter("todos")}>Todos</Chip>
              <Chip active={filter === "margem"} onClick={() => setFilter("margem")}>Margem baixa (CMV &gt; {CMV_ALERTA}%)</Chip>
            </div>
            <div className="shop-grid">
              {produtos.map((product) => {
                const cmv = cmvProduto(product, dash.ingredients || []);
                const ficha = product.fichaTecnica || product.recipe || [];
                const aberto = fichaOpen === product.id || highlightId === product.id;
                return (
                  <article key={product.id} className={`shop-card ${cmv.alerta ? "urgente" : ""}`}>
                    <div className="shop-top">
                      <QuickSelect
                        value={product.tipo || "preparo"}
                        options={[{ value: "preparo", label: "Preparo 102" }, { value: "revenda", label: "Revenda 500" }]}
                        onSave={(v) => patchProd(product.id, { tipo: v, csosn: v === "revenda" ? "500" : "102" })}
                      />
                      <div className="row-actions">
                        <DupBtn onClick={() => duplicarProd(product.id)} />
                        <ConfirmDel onConfirm={() => run(() => api.deleteProduct(product.id), "Produto excluído")} />
                      </div>
                    </div>
                    <InlineCell value={product.nome || product.name} onSave={(v) => patchProd(product.id, { name: v, nome: v })} />
                    <InlineCell type="number" step="0.01" value={product.preco_venda ?? product.price} format={(v) => money(v)} onSave={(v) => patchProd(product.id, { preco_venda: v, price: v })} />
                    <p>
                      <span className={`pill cmv-pill ${cmv.alerta ? "alerta" : ""}`}>
                        CMV <Count value={cmv.cmv} money /> · <Count value={cmv.percent} digits={1} />%
                      </span>
                    </p>
                    <div className="row">
                      <InlineCell value={product.ncm || ""} format={(v) => `NCM ${v || "—"}`} onSave={(v) => patchProd(product.id, { ncm: v })} />
                      <InlineCell value={product.cfop || "5102"} format={(v) => `CFOP ${v}`} onSave={(v) => patchProd(product.id, { cfop: v })} />
                      <InlineCell value={product.csosn || ""} format={(v) => `CSOSN ${v || "—"}`} onSave={(v) => patchProd(product.id, { csosn: v })} />
                    </div>
                    <Btn className="btn-ghost" onClick={() => setFichaOpen(aberto ? "" : product.id)}>Ficha técnica</Btn>
                    {aberto ? (
                      <div className="ficha-edit">
                        {ficha.map((row, index) => {
                          const id = row.insumo_id || row.ingredientId;
                          return (
                            <div className="row recipe-row" key={`${product.id}-${id}-${index}`}>
                              <select
                                value={id}
                                onChange={(e) => {
                                  const next = ficha.map((entry, i) => i === index ? { insumo_id: e.target.value, quantidade_usada: Number(entry.quantidade_usada ?? entry.qty ?? 0) } : { insumo_id: entry.insumo_id || entry.ingredientId, quantidade_usada: Number(entry.quantidade_usada ?? entry.qty ?? 0) });
                                  patchProd(product.id, { fichaTecnica: next });
                                }}
                              >
                                {(dash.ingredients || []).filter((i) => i.active !== false).map((ing) => (
                                  <option key={ing.id} value={ing.id}>{ing.nome || ing.name}</option>
                                ))}
                              </select>
                              <InlineCell
                                type="number"
                                step="0.01"
                                value={row.quantidade_usada ?? row.qty}
                                format={(v) => qty(v)}
                                onSave={(v) => {
                                  const next = ficha.map((entry, i) => ({
                                    insumo_id: entry.insumo_id || entry.ingredientId,
                                    quantidade_usada: i === index ? Number(v) : Number(entry.quantidade_usada ?? entry.qty ?? 0)
                                  }));
                                  patchProd(product.id, { fichaTecnica: next });
                                }}
                              />
                              <Btn className="btn-ghost" onClick={() => patchProd(product.id, { fichaTecnica: ficha.filter((_, i) => i !== index).map((entry) => ({ insumo_id: entry.insumo_id || entry.ingredientId, quantidade_usada: Number(entry.quantidade_usada ?? entry.qty ?? 0) })) })}>Tirar</Btn>
                            </div>
                          );
                        })}
                        <Btn className="btn-ghost" onClick={() => patchProd(product.id, { fichaTecnica: [...ficha.map((entry) => ({ insumo_id: entry.insumo_id || entry.ingredientId, quantidade_usada: Number(entry.quantidade_usada ?? entry.qty ?? 0) })), { insumo_id: dash.ingredients[0]?.id || "", quantidade_usada: 1 }] })}>
                          Incluir insumo
                        </Btn>
                      </div>
                    ) : (
                      <ul className="ficha-list">
                        {ficha.map((row) => {
                          const ing = (dash.ingredients || []).find((i) => i.id === (row.insumo_id || row.ingredientId));
                          return (
                            <li key={row.insumo_id || row.ingredientId}>
                              {qty(row.quantidade_usada ?? row.qty)} {ing?.unidade || ing?.unit || ""} {ing?.nome || ing?.name || row.insumo_id}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>
          </FadeTab>
        ) : null}

        {tab === "fornecedores" ? (
          <FadeTab id="fornecedores">
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>Cadastro</h3>
                <Btn className="btn-primary" onClick={() => { setEditForn(null); setFornDraft({ name: "", whatsapp: "", categoria: "Geral", prazoDias: 2 }); setFornOpen(true); }}>
                  Novo fornecedor
                </Btn>
              </div>
            </div>
            <div className="card">
              <table className="admin-table">
                <thead>
                  <tr><th>Nome</th><th>WhatsApp</th><th>Categoria</th><th>Prazo</th><th>Insumos</th><th></th></tr>
                </thead>
                <tbody>
                  {fornecedores.map((item) => {
                    const usados = (dash.ingredients || []).filter((ing) => ing.fornecedorId === item.id || ing.fornecedor === item.name || ing.supplier === item.name);
                    return (
                      <tr key={item.id}>
                        <td><InlineCell value={item.name} onSave={(v) => run(() => api.updateFornecedor(item.id, { name: v }), "Salvo")} /></td>
                        <td><InlineCell value={item.whatsapp || ""} format={(v) => v || "—"} onSave={(v) => run(() => api.updateFornecedor(item.id, { whatsapp: v }), "Salvo")} /></td>
                        <td><InlineCell value={item.categoria || ""} onSave={(v) => run(() => api.updateFornecedor(item.id, { categoria: v }), "Salvo")} /></td>
                        <td><InlineCell type="number" value={item.prazoDias} format={(v) => `${v}d`} onSave={(v) => run(() => api.updateFornecedor(item.id, { prazoDias: v }), "Salvo")} /></td>
                        <td>{usados.length}</td>
                        <td />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </FadeTab>
        ) : null}

        {tab === "perdas" ? (
          <FadeTab id="perdas">
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
                      <option>Vencido</option>
                      <option>Regulagem Moedor</option>
                      <option>Quebra/Erro</option>
                    </select>
                  </label>
                  <Btn className="btn-primary" disabled={busy} onClick={() => run(() => api.registrarPerda(perda), "Perda lançada e estoque atualizado.")}>
                    Registrar perda
                  </Btn>
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
                          <td className="tabular">{qty(row.qty)} {row.unidade}</td>
                          <td>{row.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </FadeTab>
        ) : null}

        {tab === "compra" ? (
          <FadeTab id="compra">
            <div className="card">
              <h3>Entrada de compra (XML NF-e)</h3>
              <p className="muted">Cole o XML ou deixe em branco para usar o parser mock.</p>
              <textarea rows={6} value={xml} onChange={(e) => setXml(e.target.value)} placeholder="<nfeProc>..." />
              <div className="row" style={{ marginTop: 12 }}>
                <Btn
                  className="btn-ghost"
                  disabled={busy}
                  onClick={async () => {
                    const data = await run(() => api.parseNfe(xml));
                    if (data?.itens) setNfe(data);
                  }}
                >
                  Ler XML
                </Btn>
                <Btn className="btn-primary" disabled={busy || !nfe} onClick={() => run(() => api.entradaCompra(nfe), "Estoque e custo médio atualizados.")}>
                  Conferir e entrar no estoque
                </Btn>
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
                          <td className="tabular">{qty(item.qty)} {item.unidade}</td>
                          <td className="tabular">{money(item.custo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </FadeTab>
        ) : null}

        {tab === "lista" ? (
          <FadeTab id="lista">
            {(lista.grupos || []).length === 0 ? (
              <div className="card"><p className="muted">Nenhum insumo abaixo do mínimo.</p></div>
            ) : (
              (lista.grupos || []).map((grupo) => {
                const forn = fornecedores.find((f) => f.name === grupo.fornecedor || f.id === grupo.itens?.[0]?.fornecedorId);
                const phone = waDigits(forn?.whatsapp);
                const text = listaWhatsappGrupo(grupo);
                return (
                <div className="card" key={grupo.fornecedor} style={{ marginBottom: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3 style={{ margin: 0 }}>{grupo.fornecedor}</h3>
                    <Btn
                      className="wa-btn"
                      onClick={() => {
                        navigator.clipboard?.writeText(text);
                        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
                        toast("Pedido no WhatsApp");
                      }}
                    >
                      Enviar Pedido no WhatsApp
                    </Btn>
                  </div>
                  <table className="admin-table">
                    <thead>
                      <tr><th>Insumo</th><th>Atual</th><th>Ideal</th><th>Comprar</th><th>Estimado</th></tr>
                    </thead>
                    <tbody>
                      {grupo.itens.map((item) => (
                        <tr key={item.id}>
                          <td>{item.nome}</td>
                          <td className="tabular">{qty(item.estoque_atual)} {item.unidade}</td>
                          <td className="tabular">{qty(item.estoque_ideal)}</td>
                          <td><b className="tabular">{qty(item.quantidade_comprar)}</b></td>
                          <td className="tabular">{money(item.estimado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                );
              })
            )}
          </FadeTab>
        ) : null}
      </AnimatePresence>

      <Btn className="fab" onClick={() => setPerdaOpen(true)}>
        <AlertTriangle size={16} />
        Registrar Perda
      </Btn>

      <Modal open={perdaOpen} title="Registrar perda" onClose={() => setPerdaOpen(false)}>
        <div className="form">
          <label>
            Insumo
            <select value={perda.insumoId} onChange={(e) => setPerda({ ...perda, insumoId: e.target.value })}>
              <option value="">Selecione</option>
              {(dash.ingredients || []).filter((item) => item.active !== false).map((item) => (
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
              <option>Vencido</option>
              <option>Regulagem Moedor</option>
              <option>Quebra/Erro</option>
            </select>
          </label>
          <Btn
            className="btn-primary"
            disabled={busy || !perda.insumoId}
            onClick={async () => {
              const ok = await run(() => api.registrarPerda(perda), "Perda lançada e estoque atualizado.");
              if (ok) {
                setPerdaOpen(false);
                setPerda({ insumoId: "", qty: 1, motivo: "Vencido" });
              }
            }}
          >
            Registrar perda
          </Btn>
        </div>
      </Modal>

      <Modal open={fornOpen} title={editForn ? "Editar fornecedor" : "Novo fornecedor"} onClose={() => setFornOpen(false)}>
        <div className="form">
          <label>Nome<input value={fornDraft.name} onChange={(e) => setFornDraft({ ...fornDraft, name: e.target.value })} /></label>
          <label>WhatsApp<input value={fornDraft.whatsapp} onChange={(e) => setFornDraft({ ...fornDraft, whatsapp: e.target.value })} /></label>
          <label>Categoria<input value={fornDraft.categoria} onChange={(e) => setFornDraft({ ...fornDraft, categoria: e.target.value })} /></label>
          <label>Prazo (dias)<input type="number" min="0" value={fornDraft.prazoDias} onChange={(e) => setFornDraft({ ...fornDraft, prazoDias: e.target.value })} /></label>
          <Btn
            className="btn-primary"
            disabled={busy || !fornDraft.name}
            onClick={async () => {
              const task = editForn ? () => api.updateFornecedor(editForn, fornDraft) : () => api.createFornecedor(fornDraft);
              const ok = await run(task, editForn ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
              if (ok) setFornOpen(false);
            }}
          >
            Salvar
          </Btn>
        </div>
      </Modal>
    </main>
  );
}
