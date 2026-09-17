import { Fragment } from "react";
import type { DiscordEmbed, DiscordMessage } from "../types";

// Minimal renderer for the subset of Discord markdown the digest builder
// actually emits: **bold** and `inline code`, plus literal newlines.
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-black/30 px-1 py-0.5 text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function renderMultiline(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <Fragment key={i}>
      {renderInline(line)}
      {i < lines.length - 1 && <br />}
    </Fragment>
  ));
}

function embedColor(color?: number): string {
  return color != null ? `#${color.toString(16).padStart(6, "0")}` : "#4f545c";
}

function EmbedCard({ embed }: { embed: DiscordEmbed }) {
  return (
    <div
      className="flex gap-3 rounded border-l-4 bg-[#2b2d31] p-3"
      style={{ borderColor: embedColor(embed.color) }}
    >
      <div className="min-w-0 flex-1">
        {embed.title && <div className="mb-1 text-sm font-semibold text-[#f2f3f5]">{embed.title}</div>}
        {embed.description && (
          <div className="whitespace-pre-wrap text-sm leading-snug text-[#dbdee1]">
            {renderMultiline(embed.description)}
          </div>
        )}
        {embed.footer && <div className="mt-2 text-xs text-[#949ba4]">{embed.footer.text}</div>}
      </div>
      {embed.thumbnail && (
        <img
          src={embed.thumbnail.url}
          alt=""
          className="h-16 w-16 flex-none rounded object-cover"
          loading="lazy"
        />
      )}
    </div>
  );
}

function nowLabel(): string {
  return `Today at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function DiscordPreview({ messages }: { messages: DiscordMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-lg bg-[#313338] p-4 text-sm text-[#949ba4]">
        Nothing to preview — there's nothing queued and compact mode has nothing to show.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-[#313338] p-4">
      {messages.map((msg, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-upgrade text-sm font-bold text-white">
            A
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium text-white">Arr Digest</span>
              <span className="rounded bg-upgrade px-1 py-px text-[10px] font-medium text-white">APP</span>
              <span className="text-xs text-[#949ba4]">{nowLabel()}</span>
            </div>
            {msg.content && (
              <div className="mt-0.5 text-sm text-[#dbdee1]">{renderMultiline(msg.content)}</div>
            )}
            {msg.embeds.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                {msg.embeds.map((embed, j) => (
                  <EmbedCard key={j} embed={embed} />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
