export const BLOOKET_SECRET_CODE = "1254";

export function normalizeBlooketGameId(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isBlooketSecretCode(value) {
  return normalizeBlooketGameId(value) === BLOOKET_SECRET_CODE;
}
