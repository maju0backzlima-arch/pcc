const TOKEN_KEY = "picnic-auth";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Falha na requisição.");
  return data;
}

export const api = {
  catalog: () => request("/api/catalog"),
  login: (email, password) =>
    request("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/api/logout", { method: "POST" }),
  session: () => request("/api/session"),
  sync: () => request("/api/pdv/sync", { method: "POST" }),
  adminProducts: () => request("/api/admin/products"),
  updateProduct: (id, payload) =>
    request(`/api/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
};
