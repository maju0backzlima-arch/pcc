import { useEffect, useMemo, useState } from "react";
import { Coffee, Radio, ShoppingCart } from "lucide-react";
import { api } from "../api.js";
import { errorMessage } from "../errors.js";
import { TabBtn } from "../ui/ui.jsx";

function money(value) {
  return (Number(value) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Home({ search = "" }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  const [cat, setCat] = useState("Todos");

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .catalog()
        .then((data) => {
          if (active) {
            setCatalog(data);
            setError("");
          }
        })
        .catch((err) => {
          if (active) setError(errorMessage(err));
        });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const categories = useMemo(() => {
    const list = ["Todos", ...new Set((catalog?.products || []).map((item) => item.category))];
    return list;
  }, [catalog]);

  const products = (catalog?.products || []).filter((item) => {
    const matchCat = cat === "Todos" || item.category === cat;
    const q = search.trim().toLowerCase();
    const matchQ = !q || String(item.name).toLowerCase().includes(q) || String(item.sku || "").toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="kicker">Balcão · agora</p>
          <h1>O que ainda sai da máquina.</h1>
          <p>Cada venda no PDV+ desconta a ficha técnica. Se o leite acaba, o cappuccino some daqui.</p>
        </div>
        <div className="hero-card">
          <h3>Turno</h3>
          <p>Olhe o cardápio, chame o pedido e deixe a lista de compras para o estoquista.</p>
        </div>
      </section>

      <section className="bento">
        <article className="kpi-card">
          <span className="kpi-icon brown"><Coffee size={16} /></span>
          <span className="kpi-label">Vendeu no PDV+?</span>
          <strong className="kpi-value">Ao vivo</strong>
          <span className="kpi-badge up">Receita baixa agora</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon amber"><ShoppingCart size={16} /></span>
          <span className="kpi-label">Faltou alguma coisa?</span>
          <strong className="kpi-value">Lista</strong>
          <span className="kpi-badge down">Prioridade automática</span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon green"><Radio size={16} /></span>
          <span className="kpi-label">Preço e estoque</span>
          <strong className="kpi-value">{catalog?.products?.length || 0}</strong>
          <span className="kpi-badge up">
            {catalog?.syncedAt ? new Date(catalog.syncedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Aguardando PDV+"}
          </span>
        </article>
        <article className="kpi-card">
          <span className="kpi-icon blue"><Coffee size={16} /></span>
          <span className="kpi-label">Disponíveis</span>
          <strong className="kpi-value">{(catalog?.products || []).filter((p) => p.available > 0).length}</strong>
          <span className="kpi-badge up">Cardápio ativo</span>
        </article>
      </section>

      <div className="section-head">
        <div>
          <p className="kicker">Disponível agora</p>
          <h2>O que o caixa ainda pode vender</h2>
        </div>
        <p>Atualiza sozinho. Esgotado significa que a receita ficou sem insumo.</p>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div className="cats">
        {categories.map((name) => (
          <TabBtn key={name} active={cat === name} onClick={() => setCat(name)}>
            {name}
          </TabBtn>
        ))}
      </div>

      <div className="products">
        {products.map((product) => {
          const off = product.available <= 0;
          return (
            <article key={product.id} className={`product ${off ? "off" : ""}`}>
              <span className="sku">{product.category}</span>
              <b>{product.name}</b>
              <span className={`stock-pill ${off ? "low" : product.source === "manual" ? "manual" : ""}`}>
                {off ? "Esgotado" : `${product.available} un.`}
                {product.source === "manual" ? " · ajuste manual" : ""}
              </span>
              <span className="price">{product.price > 0 ? money(product.price) : "Sob consulta"}</span>
            </article>
          );
        })}
      </div>
    </main>
  );
}
