export const ROLES = [
  { id: "admin", label: "Gerente/Dono", grupo: "gerente" },
  { id: "financeiro", label: "Financeiro", grupo: "gerente" },
  { id: "estoquista", label: "Estoquista", grupo: "estoque" },
  { id: "operador", label: "Barista/Caixa", grupo: "caixa" }
];

export function roleOf(user) {
  return user?.role || "operador";
}

export function isGerente(user) {
  const role = roleOf(user);
  return role === "admin" || role === "financeiro";
}

export function isCaixa(user) {
  return roleOf(user) === "operador";
}

export function canSeeDre(user) {
  return isGerente(user);
}

export function canEditFicha(user) {
  const role = roleOf(user);
  return role === "admin" || role === "estoquista";
}

export function canCancelFiscal(user) {
  return isGerente(user);
}

export function canManageEquipe(user) {
  return roleOf(user) === "admin";
}

export function canSeeFinanceiroFull(user) {
  return isGerente(user);
}

export function labelRole(role) {
  return ROLES.find((item) => item.id === role)?.label || role;
}
