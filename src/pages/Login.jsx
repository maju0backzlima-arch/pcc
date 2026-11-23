import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api.js";
import { errorMessage } from "../errors.js";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const navigate = useNavigate();

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api.login(email, password);
      setToken(data.token);
      onLogin(data.user);
      setSyncNote(
        `PDV+ sincronizado: ${data?.sync?.updated ?? data?.products?.length ?? 0} produtos com preço e estoque atualizados.`
      );
      navigate("/admin");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img src="/logo.webp" alt="PIC NIC" />
        <h1>Entrar</h1>
        <p>Central da cafeteria. Cardápio, estoque e caixa no mesmo turno.</p>
        <div className="form">
          <label>
            E-mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? <p className="err">{error}</p> : null}
          {syncNote ? <p className="ok">{syncNote}</p> : null}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Entrando..." : "Entrar"}
          </button>
        </div>
      </form>
    </div>
  );
}
