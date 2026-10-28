export async function onRequestGet({ env }) {
  const respond = (data, status = 200, cache = "no-store") =>
    Response.json(data, {
      status,
      headers: { "Cache-Control": cache },
    });

  if (!env.GEMINI_API_KEY) {
    return respond({ error: "GEMINI_API_KEY belum dikonfigurasi." }, 503);
  }

  let upstream;
  try {
    upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY },
    });
  } catch {
    return respond({ error: "Tidak dapat mengambil katalog Gemini." }, 502);
  }

  if (!upstream.ok) {
    return respond({ error: `Katalog Gemini mengembalikan HTTP ${upstream.status}.` }, 502);
  }

  let catalog;
  try {
    catalog = await upstream.json();
  } catch {
    return respond({ error: "Respons katalog Gemini tidak valid." }, 502);
  }

  const catalogModels = Array.isArray(catalog.models) ? catalog.models : [];
  const excludedKinds = /image|tts|embedding|transcrib|live|audio|computer|robotics|agent|banana/i;
  const models = catalogModels
    .filter(model => {
      const id = model?.name;
      const canGenerate = model?.supportedGenerationMethods?.includes("generateContent");
      return typeof id === "string" &&
        id.startsWith("models/gemini") &&
        canGenerate &&
        !excludedKinds.test(`${id} ${model.displayName || ""}`);
    })
    .map(model => ({
      id: model.name.replace(/^models\//, ""),
      name: model.displayName || model.name.replace(/^models\//, ""),
    }))
    .sort((a, b) => {
      return a.name.localeCompare(b.name);
    });

  const liveModels = catalogModels
    .filter(model => typeof model?.name === "string" &&
      model.name.startsWith("models/gemini") &&
      model.supportedGenerationMethods?.includes("bidiGenerateContent"))
    .map(model => {
      const id = model.name.replace(/^models\//, "");
      const label = `${id} ${model.displayName || ""}`;
      const kind = /transcrib/i.test(label) ? "Transkrip" : /translate/i.test(label) ? "Terjemahan" : "Suara langsung";
      return { id, name: model.displayName || id, kind };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return respond({ models, liveModels }, 200, "public, max-age=300");
}
