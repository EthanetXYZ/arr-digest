import type { DiscordMessage } from "./builder.js";

export async function sendDiscordMessages(
  webhookUrl: string,
  messages: DiscordMessage[],
): Promise<void> {
  for (const message of messages) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Discord webhook failed: ${res.status} ${body}`.trim());
    }

    // Discord webhooks are rate-limited; a small gap avoids 429s on multi-message digests.
    if (messages.length > 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
