export async function onRequestPost({ request, env }) {
  const respond = (data, status = 200) =>
    Response.json(data, {
      status,
      headers: { "Cache-Control": "no-store" },
    });

  if (!env.OPENROUTER_API_KEY) {
    return respond({ error: "OPENROUTER_API_KEY belum dikonfigurasi." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Format permintaan tidak valid." }, 400);
  }

  const model = body?.model;
  const isFreeModel =
    typeof model === "string" &&
    model.length <= 200 &&
    model.includes("/") &&
    (model === "openrouter/free" || model.endsWith(":free"));

  if (!isFreeModel) {
    return respond({ error: "Pilih model gratis OpenRouter yang tersedia." }, 400);
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

  let upstream;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Namamu Duri, asisten AI yang ramah dan membantu. Jawab menggunakan bahasa yang dipakai pengguna. Jika tidak tahu, katakan dengan jujur.",
          },
          ...messages,
        ],
        max_tokens: 700,
        temperature: 0.7,
      }),
    });
  } catch {
    return respond({ error: "Tidak dapat menghubungi OpenRouter." }, 502);
  }

  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : 502;
    return respond(
      {
        error: upstream.status === 429
          ? "Batas permintaan gratis tercapai. Coba lagi nanti atau pilih model gratis lain."
          : `OpenRouter mengembalikan HTTP ${upstream.status}.`,
      },
      status
    );
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    return respond({ error: "Respons OpenRouter tidak valid." }, 502);
  }

  const reply = result?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    return respond({ error: "OpenRouter tidak mengembalikan jawaban teks." }, 502);
  }

  return respond({ reply });
}
