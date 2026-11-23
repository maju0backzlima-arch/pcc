import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { errorMessage } from "../errors.js";
import { canManageEquipe, ROLES } from "../auth/permissoes.js";

export default function Config({ user }) {
  const [dash, setDash] = useState({ users: [], settings: {} });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [novo, setNovo] = useState({ name: "", email: "", password: "", role: "operador" });

  useEffect(() => {
    if (!user) return;
    api.dashboard().then(setDash).catch((err) => setError(errorMessage(err)));
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;
  if (!canManageEquipe(user)) {
    return (
      <main className="page">
        <p className="err">Somente o administrador gerencia colaboradores.</p>
      </main>
    );
  }

  async function run(task, ok) {
    setBusy(true);
    setError("");
    try {
      const data = await task();
      setDash(data);
      if (ok) setMessage(ok);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page admin-page">
      <div className="section-head">
        <div>
          <p className="kicker">Acesso</p>
          <h2>Colaboradores</h2>
        </div>
        <p>Cada pessoa entra com e-mail e senha próprios. Papéis limitam o que aparece na central.</p>
      </div>
      {message ? <p className="ok">{message}</p> : null}
      {error ? <p className="err">{error}</p> : null}

      <div className="split">
        <div className="card">
          <h3>Novo colaborador</h3>
          <div className="form">
            <label>Nome<input value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} /></label>
            <label>E-mail<input type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} /></label>
            <label>Senha<input type="password" value={novo.password} onChange={(e) => setNovo({ ...novo, password: e.target.value })} /></label>
            <label>Perfil
              <select value={novo.role} onChange={(e) => setNovo({ ...novo, role: e.target.value })}>
                {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => run(() => api.createColaborador(novo), "Colaborador criado.")}
            >
              Adicionar
            </button>
          </div>
        </div>
        <div className="card">
          <h3>Equipe</h3>
          <table className="admin-table">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th></th></tr></thead>
            <tbody>
              {(dash.users || []).map((item) => (
                <tr key={item.id || item.email}>
                  <td>{item.name}</td>
                  <td>{item.email}</td>
                  <td>{ROLES.find((r) => r.id === item.role)?.label || item.role}</td>
                  <td>
                    {item.email !== user.email ? (
                      <button
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => run(() => api.updateColaborador(item.id || item.email, { active: item.active === false }), item.active === false ? "Reativado." : "Desativado.")}
                      >
                        {item.active === false ? "Reativar" : "Desativar"}
                      </button>
                    ) : <span className="muted">você</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
