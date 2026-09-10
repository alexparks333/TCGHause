"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import Avatar from "./Avatar";
import type { MessageThreadSummary } from "@/lib/api";

const HOLD_MS = 6000;
// Must match .animate-message-bubble-out's duration (globals.css).
const EXIT_MS = 300;

type Phase = "in" | "out";

// Two different reasons a bubble shows up, per an explicit product
// decision: "thread" is one real, live incoming message — you're on the
// site right now and someone just said something. "digest" is the
// backlog that piled up while you were signed out, shown once as a single
// aggregate count rather than replaying every missed message as its own
// bubble the moment you log back in — same "catch up in one glance, don't
// relive it message by message" reasoning a badge count uses elsewhere in
// this codebase (NotificationBell, AccountTabs' Messages badge).
export type MessageBubbleItem =
  | { kind: "thread"; thread: MessageThreadSummary }
  | { kind: "digest"; count: number };

// A chat-head-style bubble — slides in top-right (under the header), holds
// briefly, then slides back out to the right. Deliberately not
// CelebrationToast reused with a new "kind": a message isn't a marketplace
// event like a win/sale/review, it's someone talking to you (or a backlog
// of them), so it gets its own corner, its own motion, and its own click
// target (the conversation/inbox, not a listing). MessageBubbleWatcher
// mounts one instance per queued item, stacked via `offset`.
export default function MessageBubble({
  item,
  onDone,
  offset = 0,
}: {
  item: MessageBubbleItem;
  onDone: () => void;
  offset?: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("in");

  useEffect(() => {
    const toOut = setTimeout(() => setPhase("out"), HOLD_MS);
    const toDone = setTimeout(onDone, HOLD_MS + EXIT_MS);
    return () => {
      clearTimeout(toOut);
      clearTimeout(toDone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    setPhase("out");
    setTimeout(onDone, EXIT_MS);
  }

  function open() {
    dismiss();
    router.push(item.kind === "thread" ? `/account/messages?thread=${item.thread.id}` : "/account/messages");
  }

  const name = item.kind === "thread" ? item.thread.counterpart.username ?? "Someone" : null;

  return (
    <div
      className="pointer-events-none fixed right-4 z-50 sm:right-6"
      style={{ top: `calc(4.5rem + ${offset}px)` }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter") open();
        }}
        className={`pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] cursor-pointer items-start gap-3 rounded-2xl bg-white p-3.5 shadow-[0_18px_40px_-8px_rgba(0,0,0,0.38),0_6px_16px_-4px_rgba(0,0,0,0.24)] ring-1 ring-black/5 transition-shadow hover:shadow-[0_22px_48px_-8px_rgba(0,0,0,0.44),0_8px_20px_-4px_rgba(0,0,0,0.28)] ${
          phase === "out" ? "animate-message-bubble-out" : "animate-message-bubble-in"
        }`}
      >
        {item.kind === "thread" ? (
          <Avatar label={name!} size={38} />
        ) : (
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-brand-navy text-white">
            <MessageCircle size={18} strokeWidth={2.25} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {item.kind === "thread" ? (
            <>
              <div className="flex items-center gap-1.5">
                <MessageCircle size={13} className="shrink-0 text-brand-navy" strokeWidth={2.25} />
                <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">{item.thread.lastMessageBody}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-900">
                {item.count} New Message{item.count === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                {item.count === 1 ? "You have an unread conversation." : "You have unread conversations."}
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
