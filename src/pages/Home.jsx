import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

function money(value) {
  return (Number(value) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Home() {
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
          if (active) setError(err.message);
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

  const products = (catalog?.products || []).filter(
    (item) => cat === "Todos" || item.category === cat
  );

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="kicker">Painel interno · o que dá para servir agora</p>
          <h1>Cardápio ao vivo da equipe.</h1>
          <p>
            Este é o quadro da operação. Cada venda no PDV+ baixa o estoque e a
            disponibilidade muda aqui na hora. Para compras, use a central da equipe.
          </p>
        </div>
        <div className="hero-card">
          <h3>Como a equipe usa</h3>
          <p>
            Confira o que ainda tem, chame o cliente no balcão e, se faltar insumo, a
            lista de mercado na central já aponta o que comprar.
          </p>
        </div>
      </section>

      <section className="banners">
        <article className="banner wine">
          <strong>Vendeu no PDV+? Já atualizou.</strong>
          <span>A venda consome a receita. O item some daqui se o insumo acabar.</span>
        </article>
        <article className="banner gold">
          <strong>Faltou alguma coisa?</strong>
          <span>Abra a central da equipe: a lista de mercado se monta sozinha, com prioridade.</span>
        </article>
        <article className="banner">
          <strong>Preço e estoque reais.</strong>
          <span>
            {catalog?.syncedAt
              ? `Última atualização PDV+: ${new Date(catalog.syncedAt).toLocaleString("pt-BR")}`
              : "Entre na central para ligar o PDV+ e a lista de mercado."}
          </span>
        </article>
      </section>

      <div className="section-head">
        <div>
          <p className="kicker">Disponível agora</p>
          <h2>O que o caixa ainda pode vender</h2>
        </div>
        <p>Atualiza sozinho. Esgotado significa que a receita ficou sem insumo.</p>
      </div>

      {error ? (
        <p className="err">
          {error}
          {error.includes("GitHub") || error.includes("servidor")
            ? " Abra a prévia deste ambiente ou rode npm run dev na pasta do projeto."
            : ""}
        </p>
      ) : null}

      <div className="cats">
        {categories.map((name) => (
          <button key={name} className={`tab ${cat === name ? "active" : ""}`} onClick={() => setCat(name)}>
            {name}
          </button>
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
