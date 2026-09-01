const KAHOOT_MEDIA_HOST = "https://media.kahoot.it";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_opt)?$/i;

function resolveStringImage(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("media.kahoot.it/")) {
    return `https://${trimmed}`;
  }
  if (trimmed.includes("media.kahoot.it")) {
    return trimmed.startsWith("http") ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
  }
  if (UUID_PATTERN.test(trimmed)) {
    return `${KAHOOT_MEDIA_HOST}/${trimmed}`;
  }
  return "";
}

export function resolveKahootImageUrl(raw) {
  if (raw == null || raw === "") {
    return "";
  }

  if (typeof raw === "object") {
    const direct =
      raw.url ||
      raw.uri ||
      raw.src ||
      raw.href ||
      raw.fullUrl ||
      raw.image ||
      raw.path ||
      "";
    const resolvedDirect = resolveStringImage(direct);
    if (resolvedDirect) {
      return resolvedDirect;
    }
    if (raw.id) {
      return resolveStringImage(String(raw.id));
    }
    return "";
  }

  return resolveStringImage(raw);
}

export function hasResolvedImages(entry) {
  if (!entry) {
    return false;
  }
  if (resolveKahootImageUrl(entry.imageUrl)) {
    return true;
  }
  return Array.isArray(entry.choiceImages) && entry.choiceImages.some((url) => resolveKahootImageUrl(url));
}
