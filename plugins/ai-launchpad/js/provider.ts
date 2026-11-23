export type ProviderType = "openai" | "claude" | "google";

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string; // optional override for custom endpoints/proxies
}

export interface ChatAttachment {
  id: string;
  type: "image" | "file";
  name: string;
  mimeType: string;
  data: string; // base64 for images, plain text for text files
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  attachments?: ChatAttachment[];
}

function buildTextWithFiles(msg: ChatMessage): string {
  const files = (msg.attachments ?? []).filter((a) => a.type === "file");
  if (files.length === 0) return msg.text;
  const fileBlocks = files
    .map((f) => `[File: ${f.name}]\n\`\`\`\n${f.data}\n\`\`\``)
    .join("\n\n");
  return msg.text ? `${fileBlocks}\n\n${msg.text}` : fileBlocks;
}

export async function sendToProvider(
  config: ProviderConfig,
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<string> {
  if (config.provider === "openai") {
    const url = `${config.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;
    const bodyMessages: any[] = [];
    if (systemPrompt) bodyMessages.push({ role: "system", content: systemPrompt });

    for (const m of messages) {
      const images = (m.attachments ?? []).filter((a) => a.type === "image");
      const text = buildTextWithFiles(m);
      if (images.length > 0 && m.role === "user") {
        bodyMessages.push({
          role: "user",
          content: [
            { type: "text", text },
            ...images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            })),
          ],
        });
      } else {
        bodyMessages.push({ role: m.role, content: text });
      }
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages: bodyMessages }),
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (config.provider === "claude") {
    const url = `${config.baseUrl ?? "https://api.anthropic.com/v1"}/messages`;
    const claudeMessages = messages.map((m) => {
      const images = (m.attachments ?? []).filter((a) => a.type === "image");
      const text = buildTextWithFiles(m);
      if (images.length > 0 && m.role === "user") {
        return {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image",
              source: { type: "base64", media_type: img.mimeType, data: img.data },
            })),
            { type: "text", text },
          ],
        };
      }
      return { role: m.role, content: text };
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 4096,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: claudeMessages,
      }),
    });
    if (!res.ok) throw new Error(`Claude error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content?.map((c: any) => c.text).join("") ?? "";
  }

  // Google Gemini API
  const base = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  const url = `${base}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const contents = messages.map((m) => {
    const parts: any[] = [];
    for (const img of (m.attachments ?? []).filter((a) => a.type === "image")) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
    const text = buildTextWithFiles(m);
    if (text) parts.push({ text });
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      contents,
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
}
