import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Minus, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { errorMessage } from "../errors.js";
import { METODO_LABEL, METODOS } from "../modules/financeiro/engine.js";
import { Btn, TabBtn, useToast } from "../ui/ui.jsx";

function money(value) {
  return (Number(value) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Pdv({ user, search = "" }) {
  const toast = useToast();
  const [catalog, setCatalog] = useState({ products: [] });
  const [cart, setCart] = useState([]);
  const [metodo, setMetodo] = useState("pix");
  const [cat, setCat] = useState("Todos");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);

  function load() {
    return api
      .catalog()
      .then((data) => {
        setCatalog(data);
        setError("");
      })
      .catch((err) => setError(errorMessage(err)));
  }

  useEffect(() => {
    if (!user) return;
    load();
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  const categories = useMemo(() => {
    return ["Todos", ...new Set((catalog.products || []).map((item) => item.category))];
  }, [catalog]);

  const products = (catalog.products || []).filter((item) => {
    const matchCat = cat === "Todos" || item.category === cat;
    const q = search.trim().toLowerCase();
    const matchQ = !q || String(item.name).toLowerCase().includes(q) || String(item.sku || "").toLowerCase().includes(q);
    return matchCat && matchQ && item.active !== false;
  });

  const total = cart.reduce((sum, line) => sum + line.price * line.qty, 0);

  function add(product) {
    if (product.available <= 0 || product.price <= 0) return;
    setCart((list) => {
      const found = list.find((line) => line.productId === product.id);
      if (found) {
        if (found.qty >= product.available) return list;
        return list.map((line) => (line.productId === product.id ? { ...line, qty: line.qty + 1 } : line));
      }
      return [...list, { productId: product.id, name: product.name, price: product.price, qty: 1, available: product.available }];
    });
  }

  function setQty(productId, qty) {
    const n = Math.max(0, Number(qty) || 0);
    setCart((list) => list.map((line) => (line.productId === productId ? { ...line, qty: n } : line)).filter((line) => line.qty > 0));
  }

  async function cobrar() {
    if (!cart.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api.registerSale({
        items: cart.map((line) => ({ productId: line.productId, qty: line.qty })),
        paymentMethod: metodo,
        source: "pdvplus",
        note: `Caixa interno · ${METODO_LABEL[metodo]}`
      });
      const sale = data?.lastSale || data?.sale || data?.sales?.[0];
      setLast(sale || { total, paymentMethod: metodo, items: cart });
      setCart([]);
      toast("Venda lançada. Estoque e caixa atualizados.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page pdv-page">
      <div className="section-head">
        <div>
          <p className="kicker">Caixa interno · sem homologação</p>
          <h2>PDV</h2>
        </div>
        <p>Toque no item, escolha o pagamento e cobre. A receita baixa na hora.</p>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div className="pdv-layout">
        <div>
          <div className="cats">
            {categories.map((name) => (
              <TabBtn key={name} active={cat === name} onClick={() => setCat(name)}>
                {name}
              </TabBtn>
            ))}
          </div>
          <div className="products">
            {products.map((product) => {
              const off = product.available <= 0 || product.price <= 0;
              return (
                <button
                  key={product.id}
                  type="button"
                  className={`product ${off ? "off" : ""}`}
                  disabled={off}
                  onClick={() => add(product)}
                >
                  <span className="sku">{product.category}</span>
                  <b>{product.name}</b>
                  <span className={`stock-pill ${off ? "low" : ""}`}>
                    {off ? "Esgotado" : `${product.available} un.`}
                  </span>
                  <span className="price">{product.price > 0 ? money(product.price) : "Sob consulta"}</span>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="pdv-cart card">
          <h3>Pedido</h3>
          {cart.length === 0 ? (
            <p className="muted">Toque nos produtos para montar o pedido.</p>
          ) : (
            <ul className="pdv-lines">
              {cart.map((line) => (
                <li key={line.productId}>
                  <div>
                    <b>{line.name}</b>
                    <span className="muted">{money(line.price * line.qty)}</span>
                  </div>
                  <div className="pdv-qty">
                    <Btn className="btn-ghost icon-only" onClick={() => setQty(line.productId, line.qty - 1)}>
                      <Minus size={14} />
                    </Btn>
                    <span className="tabular">{line.qty}</span>
                    <Btn className="btn-ghost icon-only" onClick={() => setQty(line.productId, line.qty + 1)}>
                      <Plus size={14} />
                    </Btn>
                    <Btn className="btn-ghost icon-only" onClick={() => setQty(line.productId, 0)}>
                      <Trash2 size={14} />
                    </Btn>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="pdv-pay">
            {METODOS.map((item) => (
              <ChipPay key={item} active={metodo === item} onClick={() => setMetodo(item)}>
                {METODO_LABEL[item]}
              </ChipPay>
            ))}
          </div>

          <div className="pdv-total">
            <span>Total</span>
            <strong className="tabular">{money(total)}</strong>
          </div>
          <Btn className="btn-primary" disabled={busy || !cart.length} onClick={cobrar} style={{ width: "100%", justifyContent: "center" }}>
            {busy ? "Registrando..." : `Cobrar ${METODO_LABEL[metodo]}`}
          </Btn>
          {last ? (
            <p className="ok" style={{ marginTop: 10 }}>
              Última: {money(last.total)} · {METODO_LABEL[last.paymentMethod] || last.paymentMethod}
            </p>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function ChipPay({ active, children, onClick }) {
  return (
    <button type="button" className={`chip ${active ? "on" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
