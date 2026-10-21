import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api, getToken, setToken } from "./api.js";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import Admin from "./pages/Admin.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    api
      .session()
      .then((data) => setUser(data.user))
      .catch(() => setToken(""))
      .finally(() => setReady(true));
  }, []);

  async function logout() {
    try {
      await api.logout();
    } catch {}
    setToken("");
    setUser(null);
    navigate("/");
  }

  if (!ready) {
    return (
      <div className="login-wrap">
        <p style={{ color: "#f8f1ea" }}>Abrindo o PIC NIC...</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topnav">
        <NavLink to="/" className="brand-lock">
          <img src="/logo.webp" alt="PIC NIC" />
          <div className="brand-copy">
            <strong>PIC NIC</strong>
            <span>Food Truck Café</span>
          </div>
        </NavLink>
        <nav className="nav-links">
          <NavLink to="/" end>
            Cardápio
          </NavLink>
          {user ? (
            <>
              <NavLink to="/admin">Painel do lojista</NavLink>
              <button className="linkish" onClick={logout}>
                Sair
              </button>
            </>
          ) : (
            <NavLink to="/login">Entrar</NavLink>
          )}
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login onLogin={setUser} />} />
        <Route path="/admin" element={<Admin user={user} />} />
      </Routes>
      <footer className="foot">
        <span>PIC NIC · Food Truck Café</span>
        <span>Preços e estoque sincronizados com PDV+</span>
      </footer>
    </div>
  );
}
