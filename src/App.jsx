import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  MonitorSmartphone,
  NotebookPen,
  Receipt,
  Search,
  Settings2,
  ShoppingBag,
  Wallet
} from "lucide-react";
import { api, getToken, setToken } from "./api.js";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import Admin from "./pages/Admin.jsx";
import Estoque from "./pages/Estoque.jsx";
import Financeiro from "./pages/Financeiro.jsx";
import Config from "./pages/Config.jsx";
import Ajuda from "./pages/Ajuda.jsx";
import Fiscal from "./pages/Fiscal.jsx";
import Pdv from "./pages/Pdv.jsx";
import { canManageEquipe, canSeeDre, isGerente, labelRole } from "./auth/permissoes.js";
import { ToastProvider } from "./ui/ui.jsx";

const TITLES = {
  "/": "Cardápio",
  "/pdv": "PDV",
  "/admin": "Central da equipe",
  "/estoque": "Estoque",
  "/financeiro": "Financeiro",
  "/notas": "Notas fiscais",
  "/config": "Equipe",
  "/ajuda": "Manual",
  "/login": "Entrar"
};

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

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

  const title = useMemo(() => {
    if (location.pathname === "/financeiro" && user && !canSeeDre(user)) return "Caixa";
    return TITLES[location.pathname] || "PIC NIC";
  }, [location.pathname, user]);

  if (!ready) {
    return (
      <div className="login-wrap">
        <p className="boot-copy">Aquecendo a máquina…</p>
      </div>
    );
  }

  if (!user) {
    const onLogin = location.pathname === "/login";
    return (
      <ToastProvider>
        <div className="shell guest">
          {onLogin ? null : (
            <header className="topbar guest-bar">
              <NavLink to="/" className="sidebar-brand" style={{ padding: 0 }}>
                <img src="/logo.webp" alt="PIC NIC" />
                <div className="brand-copy">
                  <strong style={{ color: "#1C1917" }}>PIC NIC</strong>
                  <span>Food Truck Café</span>
                </div>
              </NavLink>
              <NavLink to="/login" className="btn btn-primary">Entrar</NavLink>
            </header>
          )}
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login onLogin={setUser} />} />
            <Route path="/ajuda" element={<Ajuda />} />
            <Route path="*" element={<Login onLogin={setUser} />} />
          </Routes>
        </div>
      </ToastProvider>
    );
  }

  const links = [
    { to: "/", end: true, label: "Cardápio", icon: ShoppingBag },
    { to: "/pdv", label: "PDV", icon: MonitorSmartphone },
    { to: "/admin", label: "Central", icon: LayoutDashboard },
    { to: "/estoque", label: "Estoque", icon: NotebookPen },
    { to: "/financeiro", label: canSeeDre(user) ? "Financeiro" : "Caixa", icon: Wallet },
    { to: "/notas", label: "Notas", icon: Receipt },
    canManageEquipe(user) ? { to: "/config", label: "Equipe", icon: Settings2 } : null,
    { to: "/ajuda", label: "Manual", icon: BookOpen }
  ].filter(Boolean);

  const bottomLinks = [
    { to: "/pdv", label: "PDV", icon: MonitorSmartphone },
    { to: "/estoque", label: "Estoque", icon: NotebookPen },
    { to: "/financeiro", label: canSeeDre(user) ? "Financeiro" : "Caixa", icon: Wallet },
    { to: "/notas", label: "Notas", icon: Receipt }
  ];

  return (
    <ToastProvider>
      <div className="shell">
        <aside className="sidebar">
          <span className="sidebar-motif u" />
          <span className="sidebar-motif b" />
          <NavLink to="/" className="sidebar-brand">
            <img src="/logo.webp" alt="PIC NIC" />
            <div className="brand-copy">
              <strong>PIC NIC</strong>
              <span>Food Truck Café</span>
            </div>
          </NavLink>
          <nav className="sidebar-nav">
            {links.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} end={item.end}>
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
            <button className="linkish" onClick={logout}>
              <LogOut size={18} strokeWidth={1.8} />
              <span>Sair</span>
            </button>
          </nav>
          <div className="sidebar-foot">
            Lista de mercado atualizada a cada venda do PDV+
          </div>
        </aside>
        <div className="workspace">
          <span className="motif umbrella a" />
          <span className="motif beans b gold" />
          <span className="motif beans c coffee" />
          <span className="motif umbrella d" />
          <header className="topbar">
            <h1 className="page-title">{title}</h1>
            <div className="topbar-search">
              <Search size={16} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Busca rápida · produto, insumo, nota"
              />
            </div>
            <div className="topbar-right">
              <div className="role-switch" title={labelRole(user.role)}>
                <button type="button" className={!isGerente(user) ? "on" : ""}>Barista</button>
                <button type="button" className={isGerente(user) ? "on" : ""}>Gerente</button>
              </div>
              <CircleHelp size={18} color="#78716C" />
            </div>
          </header>
          <Routes>
            <Route path="/" element={<Home search={search} />} />
            <Route path="/pdv" element={<Pdv user={user} search={search} />} />
            <Route path="/login" element={<Login onLogin={setUser} />} />
            <Route path="/admin" element={<Admin user={user} search={search} />} />
            <Route path="/estoque" element={<Estoque user={user} search={search} />} />
            <Route path="/financeiro" element={<Financeiro user={user} search={search} />} />
            <Route path="/notas" element={<Fiscal user={user} />} />
            <Route path="/config" element={<Config user={user} />} />
            <Route path="/ajuda" element={<Ajuda />} />
          </Routes>
        </div>
        <nav className="bottom-nav">
          {bottomLinks.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to}>
                <Icon size={22} strokeWidth={1.8} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </ToastProvider>
  );
}
