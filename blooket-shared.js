export const BLOOKET_SECRET_CODE = "1254";
export const BLOOKET_JOIN_WORKER_URL =
  "https://kahoot-test-joiner-blooket.stormy1254456.workers.dev";

export function normalizeBlooketGameId(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isBlooketSecretCode(value) {
  return normalizeBlooketGameId(value) === BLOOKET_SECRET_CODE;
}
