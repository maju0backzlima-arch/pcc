import { localApi } from "./localApi.js";
import { errorMessage } from "./errors.js";

const TOKEN_KEY = "picnic-auth";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function staticHost() {
  const host = String(window.location.hostname || "");
  return (
    host.includes("vercel.app") ||
    host.includes("github.io") ||
    host.includes("netlify.app") ||
    host.includes("pages.dev")
  );
}

function looksLikeHtml(text, res) {
  const type = String(res?.headers?.get("content-type") || "");
  return type.includes("text/html") || /^\s*</.test(text || "");
}

function ourApi(data) {
  return data && (Array.isArray(data.products) || data.token || data.user || data.ok || data.sync || data.shoppingList);
}

let mode = staticHost() ? "local" : "auto";

async function request(path, options = {}) {
  if (mode === "local") return localApi.request(path, options);

  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(path, { ...options, headers });
    const text = await res.text();
    if (looksLikeHtml(text, res)) {
      mode = "local";
      return localApi.request(path, options);
    }
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      mode = "local";
      return localApi.request(path, options);
    }
    if (!res.ok) {
      if (!ourApi(data)) {
        mode = "local";
        return localApi.request(path, options);
      }
      throw new Error(errorMessage(data.error || data));
    }
    return data;
  } catch (err) {
    if (err instanceof TypeError || err?.message === "Failed to fetch") {
      mode = "local";
      return localApi.request(path, options);
    }
    throw new Error(errorMessage(err));
  }
}

export const api = {
  catalog: () => request("/api/catalog"),
  login: (email, password) =>
    request("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/api/logout", { method: "POST" }),
  session: () => request("/api/session"),
  sync: () => request("/api/pdv/sync", { method: "POST" }),
  dashboard: () => request("/api/admin/dashboard"),
  adminProducts: () => request("/api/admin/products"),
  createProduct: (payload) =>
    request("/api/admin/products", { method: "POST", body: JSON.stringify(payload) }),
  updateProduct: (id, payload) =>
    request(`/api/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  archiveProduct: (id) => request(`/api/admin/products/${id}/archive`, { method: "POST" }),
  createIngredient: (payload) =>
    request("/api/admin/ingredients", { method: "POST", body: JSON.stringify(payload) }),
  updateIngredient: (id, payload) =>
    request(`/api/admin/ingredients/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  updateSettings: (payload) =>
    request("/api/admin/settings", { method: "PATCH", body: JSON.stringify(payload) }),
  updateUser: (payload) =>
    request("/api/admin/users", { method: "PATCH", body: JSON.stringify(payload) }),
  registerSale: (payload) =>
    request("/api/admin/sales", { method: "POST", body: JSON.stringify(payload) }),
  createShoppingItem: (payload) =>
    request("/api/admin/shopping", { method: "POST", body: JSON.stringify(payload) }),
  updateShoppingItem: (id, payload) =>
    request(`/api/admin/shopping/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  buyShoppingItem: (id, payload = {}) =>
    request(`/api/admin/shopping/${id}/buy`, { method: "POST", body: JSON.stringify(payload) }),
  removeShoppingItem: (id) =>
    request(`/api/admin/shopping/${id}/remove`, { method: "POST" }),
  rebuildShopping: () => request("/api/admin/shopping/rebuild", { method: "POST" }),
  streamUrl: () => `/api/admin/stream?token=${encodeURIComponent(getToken())}`,
  localTick: () => localApi.simulateSale()
};
