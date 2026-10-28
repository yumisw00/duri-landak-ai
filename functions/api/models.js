export async function onRequestGet({ env }) {
  const respond = (data, status = 200, cache = "no-store") =>
    Response.json(data, {
      status,
      headers: { "Cache-Control": cache },
    });

  if (!env.OPENROUTER_API_KEY) {
    return respond({ error: "OPENROUTER_API_KEY belum dikonfigurasi." }, 503);
  }

  let upstream;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/models?output_modalities=text", {
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
    });
  } catch {
    return respond({ error: "Tidak dapat mengambil katalog OpenRouter." }, 502);
  }

  if (!upstream.ok) {
    return respond({ error: `Katalog OpenRouter mengembalikan HTTP ${upstream.status}.` }, 502);
  }

  let catalog;
  try {
    catalog = await upstream.json();
  } catch {
    return respond({ error: "Respons katalog OpenRouter tidak valid." }, 502);
  }

  const models = (Array.isArray(catalog.data) ? catalog.data : [])
    .filter(model => {
      const id = model?.id;
      if (typeof id !== "string") return false;
      if (id === "openrouter/free") return true;

      const freeVariant = id.endsWith(":free");
      const freePricing =
        Number(model.pricing?.prompt) === 0 &&
        Number(model.pricing?.completion) === 0;
      const acceptsText = model.architecture?.input_modalities?.includes("text");
      const returnsText = model.architecture?.output_modalities?.includes("text");

      return freeVariant && freePricing && acceptsText && returnsText;
    })
    .map(model => ({
      id: model.id,
      name: model.name || model.id,
    }))
    .sort((a, b) => {
      if (a.id === "openrouter/free") return -1;
      if (b.id === "openrouter/free") return 1;
      return a.name.localeCompare(b.name);
    });

  return respond({ models }, 200, "public, max-age=300");
}
