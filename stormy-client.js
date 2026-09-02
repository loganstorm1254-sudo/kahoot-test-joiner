const MAX_INLINE_BYTES = 4_500_000;

export async function fetchImageInline(imageUrl) {
  const url = String(imageUrl || "").trim();
  if (!url) {
    return null;
  }

  try {
    let response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) {
      response = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
    }
    if (!response.ok) {
      return null;
    }

    const mime = (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 80 || buffer.byteLength > MAX_INLINE_BYTES) {
      return null;
    }

    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }

    return {
      data: btoa(binary),
      mime,
    };
  } catch {
    try {
      const response = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        return null;
      }
      const mime = (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 80 || buffer.byteLength > MAX_INLINE_BYTES) {
        return null;
      }
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
      }
      return { data: btoa(binary), mime };
    } catch {
      return null;
    }
  }
}

export async function buildInlineImages(imageUrl, choiceImages = []) {
  const [question, ...choiceResults] = await Promise.all([
    fetchImageInline(imageUrl),
    ...choiceImages.map((url) => fetchImageInline(url)),
  ]);

  const choices = choiceResults.filter(Boolean);
  if (!question && !choices.length) {
    return null;
  }

  return {
    question: question || null,
    choices,
  };
}
