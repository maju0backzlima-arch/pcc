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
    const timer = setInterval(load, 20000);
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
          <p className="kicker">Café artesanal · cardápio do dia</p>
          <h1>Sabor de food truck, atendimento de casa.</h1>
          <p>
            Cappuccinos, sucos, gratinados e omeletes feitos na hora. Preço e estoque
            atualizados direto do PDV+ — o que você vê aqui é o que está no caixa.
          </p>
        </div>
        <div className="hero-card">
          <h3>Pronto para servir</h3>
          <p>
            Peça no balcão, leve para a mesa ou para a estrada. Cardápio curto, execução
            rápida e o mesmo padrão PIC NIC de sempre.
          </p>
        </div>
      </section>

      <section className="banners">
        <article className="banner wine">
          <strong>Café na hora, sem fila de espera.</strong>
          <span>Do moinho à xícara: o cardápio quente sai alinhado com o estoque do PDV+.</span>
        </article>
        <article className="banner gold">
          <strong>Peça agora. Leve quente.</strong>
          <span>Gratinados, omeletes e pães na chapa para o almoço rápido no ponto.</span>
        </article>
        <article className="banner">
          <strong>Preço certo. Estoque real.</strong>
          <span>
            {catalog?.syncedAt
              ? `Última sincronização PDV+: ${new Date(catalog.syncedAt).toLocaleString("pt-BR")}`
              : "Valores oficiais da loja, atualizados a cada login do lojista."}
          </span>
        </article>
      </section>

      <div className="section-head">
        <div>
          <p className="kicker">Cardápio</p>
          <h2>Escolha e peça no balcão</h2>
        </div>
        <p>Itens alinhados, porções claras e disponibilidade em tempo real.</p>
      </div>

      {error ? <p className="err">{error}</p> : null}

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
