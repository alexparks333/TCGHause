"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getMyThreadsClient } from "@/lib/api";
import MessageBubble, { type MessageBubbleItem } from "./MessageBubble";

// Its own poll, independent of NotificationBell's /me/notifications poll
// (won/sold/outbid/review) — messages are a deliberately separate concept
// end to end, not another notification kind, so they don't share a poll,
// a queue, or a visual language with either NotificationBell or
// CelebrationToast.
const POLL_MS = 15000;

// Vertical spacing between stacked bubbles.
const BUBBLE_SPACING_PX = 92;

interface QueuedBubble {
  key: string;
  item: MessageBubbleItem;
}

const PokeMessagesContext = createContext<() => void>(() => {});

// The "which threads has this browser already been shown, as of what
// lastMessageAt" baseline persists to localStorage (scoped per user id) —
// not just the in-memory ref below — because a real sign-out/sign-in is a
// full page reload, which remounts this whole component tree and would
// otherwise reset the baseline to empty. Without this, the exact same
// still-unread backlog from before signing out gets treated as a brand
// new backlog on every sign-in and re-triggers the "N New Messages" digest
// bubble for messages the user has already been shown. Per-viewer
// convenience state, not shared/critical data, so localStorage (rather
// than a real backend concept) is the right fit — see CLAUDE.md's browser
// storage guidance.
function seenStorageKey(userId: string): string {
  return `mbw:seen:${userId}`;
}

function loadSeen(userId: string): Map<string, string> | null {
  try {
    const raw = localStorage.getItem(seenStorageKey(userId));
    if (!raw) return null;
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    return null;
  }
}

function saveSeen(userId: string, seen: Map<string, string>) {
  try {
    localStorage.setItem(seenStorageKey(userId), JSON.stringify(Object.fromEntries(seen)));
  } catch {
    // Best-effort — a private window or blocked site data just means this
    // falls back to the old in-memory-only behavior for that session.
  }
}

// Lets the dev panel's "Get a Message" button force an immediate poll
// right after it asks the backend to send a real test message, instead of
// waiting up to POLL_MS for the bubble to show up — same shape as
// CelebrationWatcher's usePokeCelebrations.
export function usePokeMessages() {
  return useContext(PokeMessagesContext);
}

// Polls for incoming messages and shows exactly one of two very different
// things, per an explicit product decision:
//
//   - The very first poll after this watcher mounts (a fresh page load —
//     in practice, "just logged in" or "just opened the site") never pops
//     a per-thread bubble for whatever's already unread. Instead, if
//     unreadCount > 0, it shows ONE "N New Messages" digest bubble — a
//     backlog that piled up while you were away gets summarized, not
//     replayed message by message.
//   - Every poll after that pops a real per-thread MessageBubble for any
//     thread whose last message isn't the caller's own and is newer than
//     what's already been accounted for — this is "someone is messaging
//     you right now, while you're actually here," and it deserves to feel
//     live.
//
// Deliberately outside NotificationBell/CelebrationWatcher entirely: an
// incoming message is a different kind of event from a marketplace event
// (you won/sold/got reviewed), so it gets its own watcher, its own corner,
// and its own motion. Wraps the whole app (app/layout.tsx), same placement
// reasoning as CelebrationWatcher, so DevQuickSwitch's "Get a Message"
// button (also mounted there) can reach usePokeMessages().
export default function MessageBubbleWatcher({ children }: { children?: React.ReactNode }) {
  const [queue, setQueue] = useState<QueuedBubble[]>([]);
  // threadId -> lastMessageAt already accounted for. Seeded on the very
  // first poll (see `initialized` below) so a pre-existing backlog doesn't
  // also look "new" to every poll after it.
  const seen = useRef(new Map<string, string>());
  const initialized = useRef(false);

  const poll = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const userId = session.user.id;

    try {
      const { threads, unreadCount } = await getMyThreadsClient();
      console.log("[MBW-DEBUG] poll " + JSON.stringify({ userId, unreadCount, initializedBefore: initialized.current, persistedExists: !!loadSeen(userId) }));

      if (!initialized.current) {
        initialized.current = true;
        const persisted = loadSeen(userId);
        if (persisted) {
          // This browser has already shown this user a digest (or later
          // per-thread bubbles) before — resume from that baseline instead
          // of treating the still-unread backlog as new again.
          seen.current = persisted;
        } else {
          // Genuinely the first time this user has ever loaded messaging
          // on this browser — seed silently and show one consolidated
          // digest bubble for whatever's already unread, same as before.
          threads.forEach((t) => seen.current.set(t.id, t.lastMessageAt));
          saveSeen(userId, seen.current);
          if (unreadCount > 0) {
            setQueue((q) => [...q, { key: `digest:${Date.now()}`, item: { kind: "digest", count: unreadCount } }]);
          }
          return;
        }
      }

      const fresh: QueuedBubble[] = [];
      for (const t of threads) {
        const prev = seen.current.get(t.id);
        seen.current.set(t.id, t.lastMessageAt);
        if (t.lastMessageIsMine || prev === t.lastMessageAt) continue;
        fresh.push({ key: `${t.id}:${t.lastMessageAt}`, item: { kind: "thread", thread: t } });
      }
      saveSeen(userId, seen.current);
      if (fresh.length > 0) setQueue((q) => [...q, ...fresh]);
    } catch {
      // Best-effort — a missed poll just gets retried next interval.
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return (
    <PokeMessagesContext.Provider value={poll}>
      {children}
      {queue.map((q, i) => (
        <MessageBubble
          key={q.key}
          item={q.item}
          offset={i * BUBBLE_SPACING_PX}
          onDone={() => setQueue((cur) => cur.filter((c) => c.key !== q.key))}
        />
      ))}
    </PokeMessagesContext.Provider>
  );
}
