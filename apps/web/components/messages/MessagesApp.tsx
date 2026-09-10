"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import ThreadListItem from "./ThreadListItem";
import ThreadView from "./ThreadView";
import {
  getMyThreadsClient,
  getMessageThreadClient,
  sendMessage as sendMessageApi,
  type MessageThreadSummary,
  type MessageThreadDetail,
} from "@/lib/api";

const THREAD_LIST_POLL_MS = 15000;
// Shorter than the inbox-wide poll — the whole point of having a
// conversation open is that it should feel like it's updating live, the
// same reasoning CLAUDE.md's auction price box has for polling faster than
// a background list.
const OPEN_THREAD_POLL_MS = 4000;

function upsertThreadPreview(
  threads: MessageThreadSummary[],
  threadId: string,
  body: string,
): MessageThreadSummary[] {
  const idx = threads.findIndex((t) => t.id === threadId);
  if (idx === -1) return threads;
  const updated: MessageThreadSummary = {
    ...threads[idx],
    lastMessageKind: "text",
    lastMessageBody: body,
    lastMessageAt: new Date().toISOString(),
    lastMessageIsMine: true,
    unread: false,
  };
  const rest = threads.filter((t) => t.id !== threadId);
  return [updated, ...rest];
}

// Server-fetched initial state (account/messages/page.tsx passes these
// down), then kept current with polling — same reasoning as
// NotificationBell throughout this codebase: no client-only initial
// render, and no websocket infra exists yet so polling is the real-time
// stand-in.
export default function MessagesApp({
  currentUserId,
  initialThreads,
  initialThreadId,
  initialDetail,
}: {
  currentUserId: string;
  initialThreads: MessageThreadSummary[];
  initialThreadId?: string;
  initialDetail?: MessageThreadDetail | null;
}) {
  const router = useRouter();
  const [threads, setThreads] = useState(initialThreads);
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId ?? null);
  const [detail, setDetail] = useState<MessageThreadDetail | null>(initialDetail ?? null);
  const [detailLoading, setDetailLoading] = useState(false);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const refreshThreads = useCallback(async () => {
    try {
      const data = await getMyThreadsClient();
      setThreads(data.threads);
    } catch {
      // Best-effort — a missed poll just gets retried next interval.
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refreshThreads, THREAD_LIST_POLL_MS);
    return () => clearInterval(id);
  }, [refreshThreads]);

  useEffect(() => {
    if (!selectedId) return;
    const id = setInterval(async () => {
      try {
        const data = await getMessageThreadClient(selectedId);
        // The poll interval can outlive the user switching threads again
        // before it fires — only apply a stale response if it's still for
        // the thread currently open.
        if (selectedIdRef.current === selectedId) setDetail(data);
      } catch {
        // Best-effort, same as refreshThreads.
      }
    }, OPEN_THREAD_POLL_MS);
    return () => clearInterval(id);
  }, [selectedId]);

  async function selectThread(id: string) {
    setSelectedId(id);
    router.replace(`/account/messages?thread=${id}`, { scroll: false });
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, unread: false } : t)));
    if (detail?.id !== id) {
      setDetailLoading(true);
      try {
        const data = await getMessageThreadClient(id);
        if (selectedIdRef.current === id) setDetail(data);
      } finally {
        setDetailLoading(false);
      }
    }
  }

  function handleBack() {
    setSelectedId(null);
    router.replace("/account/messages", { scroll: false });
  }

  async function handleSend(body: string) {
    if (!selectedId) return;
    const msg = await sendMessageApi(selectedId, body);
    setDetail((prev) => (prev && prev.id === selectedId ? { ...prev, messages: [...prev.messages, msg] } : prev));
    setThreads((prev) => upsertThreadPreview(prev, selectedId, body));
  }

  // Accepting/declining an offer bubble inside the open thread — refetch
  // both the thread (so the bubble's own status flips immediately, not
  // after the next OPEN_THREAD_POLL_MS tick) and the thread list (so its
  // last-message preview/ordering stays current too), same "instant, not
  // eventually" feel the listing page and Bids/Offers already have for
  // their own accept/decline buttons.
  async function handleOfferResolved() {
    if (!selectedId) return;
    try {
      const data = await getMessageThreadClient(selectedId);
      if (selectedIdRef.current === selectedId) setDetail(data);
    } catch {
      // Best-effort — the regular poll will catch up if this one fails.
    }
    refreshThreads();
  }

  return (
    // A genuinely fixed height, not min-h-*/flex-1 — this box's own
    // ancestors (AccountLayout's <main>) are sized by min-h-screen, not a
    // bounded height, so flex-1 here had nothing bounded to divide and the
    // box just grew to fit however many messages/offers were in the
    // longest thread, pushing the whole page into a page-level scroll
    // instead of scrolling internally. A fixed height sidesteps that
    // entirely: the box always looks like a normal chat window, and both
    // panes (the thread list, and ThreadView's own message list) scroll
    // within it via their own overflow-y-auto.
    <div className="mt-6 flex h-[600px] overflow-hidden rounded-xl border border-brand-border bg-white">
      <div
        className={`w-full shrink-0 overflow-y-auto border-brand-border md:block md:w-80 md:border-r ${
          selectedId ? "hidden md:block" : "block"
        }`}
      >
        {threads.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <MessageSquare size={28} className="text-gray-300" />
            <p className="text-sm font-medium text-gray-700">No messages yet</p>
            <p className="text-xs text-gray-500">
              Tap &ldquo;Message Seller&rdquo; on a listing to start a conversation.
            </p>
          </div>
        ) : (
          threads.map((thread) => (
            <ThreadListItem
              key={thread.id}
              thread={thread}
              active={thread.id === selectedId}
              onSelect={() => selectThread(thread.id)}
            />
          ))
        )}
      </div>

      <div className={`min-w-0 flex-1 ${selectedId ? "flex" : "hidden md:flex"}`}>
        {selectedId && detail && detail.id === selectedId ? (
          <ThreadView
            detail={detail}
            currentUserId={currentUserId}
            onBack={handleBack}
            onSend={handleSend}
            onOfferResolved={handleOfferResolved}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageSquare size={28} className="text-gray-300" />
            <p className="text-sm text-gray-500">
              {detailLoading
                ? "Loading conversation..."
                : threads.length === 0
                  ? "Nothing to show yet."
                  : "Select a conversation to view it."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
