import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api.js";
import { errorMessage } from "../errors.js";
import { Btn } from "../ui/ui.jsx";

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
      navigate("/pdv");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <span className="login-motif u" />
      <span className="login-motif b" />
      <span className="login-motif b2" />
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
          <Btn className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Entrando..." : "Entrar"}
          </Btn>
        </div>
      </form>
    </div>
  );
}
