"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import Avatar from "@/components/Avatar";
import type { MessageThreadDetail } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

export default function ThreadView({
  detail,
  currentUserId,
  onBack,
  onSend,
}: {
  detail: MessageThreadDetail;
  currentUserId: string;
  onBack: () => void;
  onSend: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const name = detail.counterpart.username ?? "Deleted user";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [detail.id, detail.messages.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    try {
      await onSend(body);
    } catch {
      setError("Message didn't send — try again.");
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-brand-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="rounded-md p-1 text-gray-500 hover:bg-brand-surface md:hidden"
        >
          <ArrowLeft size={18} />
        </button>
        <Avatar label={name} size={36} />
        <div className="min-w-0 flex-1">
          {detail.counterpart.username ? (
            <Link
              href={`/seller/${detail.counterpart.username}`}
              className="truncate text-sm font-semibold text-gray-900 hover:underline"
            >
              {name}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
          )}
        </div>
      </div>

      {detail.listing && (
        <Link
          href={`/listing/${detail.listing.id}`}
          className="flex items-center gap-2.5 border-b border-brand-border bg-brand-surface px-4 py-2 text-xs text-gray-600 hover:bg-brand-border/40"
        >
          <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded bg-white">
            {detail.listing.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detail.listing.imageUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <span className="truncate">
            About: <span className="font-medium text-gray-800">{detail.listing.title}</span>
          </span>
        </Link>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {detail.messages.map((m) => {
          const mine = m.senderId === currentUserId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                <div
                  className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
                    mine
                      ? "rounded-br-sm bg-brand-navy text-white"
                      : "rounded-bl-sm bg-brand-surface text-gray-800"
                  }`}
                >
                  {m.body}
                </div>
                <span className="mt-0.5 px-1 text-[11px] text-gray-400">
                  {formatRelativeTime(m.createdAt)}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-brand-border p-3">
        {error && <p className="mb-1.5 text-xs text-brand-urgent">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`Message ${name}...`}
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-xl border border-brand-border px-3.5 py-2.5 text-sm outline-none focus:border-brand-navy"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-navy text-white transition-colors hover:bg-brand-navy-light disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
