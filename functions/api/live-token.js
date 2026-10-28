export async function onRequestPost({ request, env }) {
  const respond = (data, status = 200) => Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

  if (!env.GEMINI_API_KEY) {
    return respond({ error: "GEMINI_API_KEY belum dikonfigurasi." }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return respond({ error: "Format permintaan tidak valid." }, 400); }
  const model = body?.model;
  if (typeof model !== "string" || !model.startsWith("gemini") || model.length > 200) {
    return respond({ error: "Pilih model Gemini Live yang tersedia." }, 400);
  }

  let catalogResponse;
  try {
    catalogResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY },
    });
  } catch {
    return respond({ error: "Tidak dapat memeriksa katalog Gemini." }, 502);
  }
  if (!catalogResponse.ok) return respond({ error: "Katalog Gemini tidak dapat diakses." }, 502);

  let catalog;
  try { catalog = await catalogResponse.json(); } catch { return respond({ error: "Respons katalog Gemini tidak valid." }, 502); }
  const selected = (Array.isArray(catalog.models) ? catalog.models : []).find(item =>
    item?.name === `models/${model}` && item?.supportedGenerationMethods?.includes("bidiGenerateContent")
  );
  if (!selected) return respond({ error: "Model Live ini tidak tersedia untuk API key kamu." }, 400);

  const descriptor = `${selected.name} ${selected.displayName || ""}`;
  const isTranscription = /transcrib/i.test(descriptor);
  const isTranslation = /translate/i.test(descriptor);
  const config = isTranscription
    ? { responseModalities: ["TEXT"], inputAudioTranscription: {} }
    : {
        responseModalities: ["AUDIO"],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        ...(isTranslation ? { translationConfig: { targetLanguageCode: typeof body.targetLanguage === "string" ? body.targetLanguage : "id" } } : {}),
      };

  const now = Date.now();
  let tokenResponse;
  try {
    tokenResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(now + 25 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
        liveConnectConstraints: { model: selected.name, config },
      }),
    });
  } catch {
    return respond({ error: "Tidak dapat membuat token sementara Gemini." }, 502);
  }
  let tokenData;
  try { tokenData = await tokenResponse.json(); } catch { return respond({ error: "Respons token Gemini tidak valid." }, 502); }
  if (!tokenResponse.ok || typeof tokenData?.name !== "string") {
    return respond({ error: tokenData?.error?.message || "Gemini menolak pembuatan token Live." }, tokenResponse.status === 429 ? 429 : 502);
  }

  return respond({ token: tokenData.name, model, config });
}
