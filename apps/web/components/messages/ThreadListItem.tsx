import Avatar from "@/components/Avatar";
import type { MessageThreadSummary } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

export default function ThreadListItem({
  thread,
  active,
  onSelect,
}: {
  thread: MessageThreadSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const name = thread.counterpart.username ?? "Deleted user";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 border-b border-brand-border px-4 py-3 text-left transition-colors ${
        active ? "bg-brand-navy/[0.06]" : "hover:bg-brand-surface"
      }`}
    >
      <Avatar label={name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className={`truncate text-sm ${
              thread.unread ? "font-semibold text-gray-900" : "font-medium text-gray-700"
            }`}
          >
            {name}
          </p>
          <span className="shrink-0 text-xs text-gray-400">
            {formatRelativeTime(thread.lastMessageAt)}
          </span>
        </div>
        {thread.listing && (
          <p className="mt-0.5 truncate text-xs text-brand-navy/70">Re: {thread.listing.title}</p>
        )}
        <div className="mt-0.5 flex items-center gap-1.5">
          {thread.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-gold" />}
          <p
            className={`truncate text-sm ${
              thread.unread ? "text-gray-800" : "text-gray-500"
            }`}
          >
            {thread.lastMessageIsMine && <span className="text-gray-400">You: </span>}
            {thread.lastMessageBody}
          </p>
        </div>
      </div>
    </button>
  );
}
