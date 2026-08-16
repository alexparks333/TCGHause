import { getMyThreads, getMessageThread } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import MessagesApp from "@/components/messages/MessagesApp";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { thread } = await searchParams;
  // Local cookie read, not a verified getCurrentSession()/getUser() call —
  // app/account/layout.tsx already gates this whole route on a real
  // verified session, same reasoning as the Watchlist/Selling pages.
  const local = await getLocalSession();

  const initialThreads = local
    ? (await getMyThreads(local.accessToken).catch(() => ({ threads: [], unreadCount: 0 }))).threads
    : [];

  // A stale/foreign ?thread= (deleted conversation, someone else's link)
  // just falls back to no selection rather than erroring the whole page —
  // same "degrade, don't crash" reasoning as getListing's 404 -> null.
  const initialDetail =
    local && thread ? await getMessageThread(thread, local.accessToken).catch(() => null) : null;

  return (
    // h-full + flex-col so MessagesApp's flex-1 pane below can consume
    // exactly what's left of AccountLayout's own flex-1 <main> — no magic
    // viewport-height constant to keep in sync with the header/tabs chrome
    // above it, and no page-level scroll: the inbox and thread panes scroll
    // internally instead, the way an actual mail client's two-pane layout
    // does.
    <div className="flex h-full flex-col px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="shrink-0 text-xl font-bold text-gray-900">Messages</h1>
      <p className="mt-1 shrink-0 text-sm text-gray-500">
        Conversations with buyers and sellers.
      </p>
      <MessagesApp
        currentUserId={local?.userId ?? ""}
        initialThreads={initialThreads}
        initialThreadId={initialDetail ? thread : undefined}
        initialDetail={initialDetail}
      />
    </div>
  );
}
