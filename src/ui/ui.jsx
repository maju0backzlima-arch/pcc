import { createContext, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Trash2, X } from "lucide-react";

const spring = { type: "spring", stiffness: 400, damping: 25 };
const ToastCtx = createContext(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  function push(text) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((list) => [...list.slice(-4), { id, text }]);
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 2600);
  }
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        <AnimatePresence>
          {toasts.map((item) => (
            <motion.div
              key={item.id}
              className="toast"
              initial={{ y: 18, opacity: 0, scale: 0.96 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0 }}
              transition={spring}
            >
              <motion.span
                className="toast-check"
                initial={{ scale: 0.4 }}
                animate={{ scale: [0.4, 1.18, 1] }}
                transition={{ duration: 0.35 }}
              >
                <Check size={14} strokeWidth={2.6} />
              </motion.span>
              {item.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function Btn({ className = "", children, disabled, type = "button", ...props }) {
  const kind = className.includes("btn-primary") || className.includes("btn-gold") || className.includes("wa-btn") || className.includes("fab")
    ? className
    : className.includes("btn-ghost") || className.includes("btn-secondary")
      ? className
      : `btn-secondary ${className}`;
  return (
    <motion.button
      type={type}
      className={`btn ${kind}`}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={{ duration: 0.15 }}
      {...props}
    >
      {children}
    </motion.button>
  );
}

export function TabBtn({ active, children, onClick }) {
  return (
    <motion.button
      type="button"
      className={`tab ${active ? "active" : ""}`}
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      transition={spring}
    >
      {children}
    </motion.button>
  );
}

export function Count({ value, money, digits = 0 }) {
  const [n, setN] = useState(Number(value) || 0);
  useEffect(() => {
    const from = n;
    const to = Number(value) || 0;
    const start = performance.now();
    let raf;
    function tick(now) {
      const p = Math.min(1, (now - start) / 620);
      const eased = 1 - (1 - p) ** 3;
      setN(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  if (money) {
    return (
      <span className="tabular">
        {(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </span>
    );
  }
  return <span className="tabular">{n.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}</span>;
}

export function InlineCell({ value, type = "text", step, format, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const ref = useRef(null);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  function commit() {
    setEditing(false);
    const next = type === "number" ? Number(draft) : String(draft);
    if (String(next) === String(value ?? "")) return;
    onSave(next);
  }
  if (!editing) {
    return (
      <button type="button" className="inline-value tabular" onClick={() => { setDraft(value ?? ""); setEditing(true); }}>
        {format ? format(value) : (value ?? "—")}
      </button>
    );
  }
  return (
    <input
      ref={ref}
      className="inline-input tabular"
      type={type}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

export function Modal({ open, title, onClose, children }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className="modal-card"
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>{title}</h3>
              <button type="button" className="icon-btn" onClick={onClose}><X size={16} /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function FornecedorSelect({ value, list = [], onSave }) {
  const selected = list.find((item) => item.id === value || item.name === value)?.id || value || "";
  return (
    <select
      className="inline-input"
      value={selected}
      onChange={(e) => onSave(e.target.value)}
    >
      <option value="">Sem fornecedor</option>
      {list.map((item) => (
        <option key={item.id} value={item.id}>{item.name}</option>
      ))}
    </select>
  );
}

export function ConfirmDel({ onConfirm, label = "Excluir" }) {
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!ask) return;
    const t = setTimeout(() => setAsk(false), 3000);
    return () => clearTimeout(t);
  }, [ask]);
  return (
    <Btn
      className={ask ? "btn-gold" : "btn-ghost icon-only"}
      onClick={() => {
        if (ask) onConfirm();
        else setAsk(true);
      }}
    >
      <Trash2 size={14} />
      {ask ? "Confirmar?" : null}
    </Btn>
  );
}

export function DupBtn({ onClick }) {
  return (
    <Btn className="btn-ghost icon-only" onClick={onClick} title="Duplicar">
      <Copy size={14} />
    </Btn>
  );
}

export function QuickSelect({ value, options, onSave }) {
  return (
    <select className="inline-input" value={value || ""} onChange={(e) => onSave(e.target.value)}>
      {options.map((opt) => (
        <option key={opt.value ?? opt} value={opt.value ?? opt}>{opt.label ?? opt}</option>
      ))}
    </select>
  );
}

export function Chip({ active, children, onClick }) {
  return (
    <motion.button
      type="button"
      className={`chip ${active ? "on" : ""}`}
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      transition={spring}
    >
      {children}
    </motion.button>
  );
}

export function FadeTab({ id, children }) {
  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
    >
      {children}
    </motion.div>
  );
}
