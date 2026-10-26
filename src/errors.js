export function errorMessage(value) {
  if (!value) return "Não foi possível concluir agora.";
  if (typeof value === "string") {
    if (value === "[object Object]") return "Não foi possível concluir agora.";
    return value;
  }
  if (value instanceof Error) return errorMessage(value.message);
  if (typeof value === "object") {
    return errorMessage(value.error || value.message || value.msg || value.detail);
  }
  return "Não foi possível concluir agora.";
}
