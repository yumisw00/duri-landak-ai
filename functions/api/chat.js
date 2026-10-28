export async function onRequestPost({ request, env }) {
  const respond = (data, status = 200) =>
    Response.json(data, {
      status,
      headers: { "Cache-Control": "no-store" },
    });

  if (!env.GEMINI_API_KEY) {
    return respond({ error: "GEMINI_API_KEY belum dikonfigurasi." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Format permintaan tidak valid." }, 400);
  }

  const model = body?.model;
  const isGeminiModel =
    typeof model === "string" &&
    model.length <= 200 &&
    model.startsWith("gemini");

  if (!isGeminiModel) {
    return respond({ error: "Pilih model Gemini yang tersedia." }, 400);
  }

  if (
    !Array.isArray(body?.messages) ||
    body.messages.length < 1 ||
    body.messages.length > 20
  ) {
    return respond({ error: "Riwayat pesan harus berisi 1 sampai 20 pesan." }, 400);
  }

  const messages = [];
  for (const message of body.messages) {
    if (
      !message ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      !message.content.trim() ||
      message.content.length > 5000
    ) {
      return respond({ error: "Ada pesan yang tidak valid atau terlalu panjang." }, 400);
    }

    messages.push({
      role: message.role,
      content: message.content.trim(),
    });
  }

  let catalogResponse;
  try {
    catalogResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY },
    });
  } catch {
    return respond({ error: "Tidak dapat memeriksa katalog Gemini." }, 502);
  }

  if (!catalogResponse.ok) {
    return respond({ error: "Katalog Gemini tidak dapat diakses." }, 502);
  }

  let catalog;
  try {
    catalog = await catalogResponse.json();
  } catch {
    return respond({ error: "Respons katalog Gemini tidak valid." }, 502);
  }

  const selectedModel = (Array.isArray(catalog.models) ? catalog.models : []).find(item =>
    item?.name === `models/${model}` &&
    item?.supportedGenerationMethods?.includes("generateContent") &&
    !/image|tts|embedding|transcrib|live|audio|computer|robotics|agent|banana/i.test(
      `${item.name} ${item.displayName || ""}`
    )
  );

  if (!selectedModel) {
    return respond({ error: "Model Gemini ini tidak tersedia untuk API key kamu." }, 400);
  }

  let upstream;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "Namamu Duri, asisten AI yang ramah dan membantu. Jawab menggunakan bahasa yang dipakai pengguna. Jika tidak tahu, katakan dengan jujur.",
          }],
        },
        contents: messages.map(message => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          maxOutputTokens: Math.min(700, selectedModel.outputTokenLimit || 700),
        },
      }),
      }
    );
  } catch {
    return respond({ error: "Tidak dapat menghubungi Gemini." }, 502);
  }

  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : 502;
    let detail = null;
    try { detail = await upstream.json(); } catch {}
    return respond(
      {
        error: upstream.status === 429
          ? "Batas permintaan Gemini untuk model ini tercapai. Coba lagi nanti atau pilih model lain."
          : (detail?.error?.message || `Gemini mengembalikan HTTP ${upstream.status}.`),
      },
      status
    );
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    return respond({ error: "Respons Gemini tidak valid." }, 502);
  }

  const reply = result?.candidates?.[0]?.content?.parts
    ?.filter(part => typeof part.text === "string")
    .map(part => part.text)
    .join("");
  if (typeof reply !== "string" || !reply.trim()) {
    return respond({ error: "Gemini tidak mengembalikan jawaban teks." }, 502);
  }

  return respond({ reply });
}
