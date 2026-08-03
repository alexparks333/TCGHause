import type { MessageThread } from "@/lib/mock-account";

export default function MessageList({ threads }: { threads: MessageThread[] }) {
  if (threads.length === 0) {
    return <p className="mt-6 text-sm text-gray-500">No messages yet.</p>;
  }

  return (
    <div className="mt-6 divide-y divide-brand-border overflow-hidden rounded-xl border border-brand-border bg-white">
      {threads.map((thread) => (
        <div key={thread.id} className="flex items-start gap-3 px-4 py-3">
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
              thread.unread ? "bg-brand-gold" : "bg-transparent"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p
                className={`truncate text-sm ${
                  thread.unread ? "font-semibold text-gray-900" : "font-medium text-gray-700"
                }`}
              >
                {thread.from}
              </p>
              <p className="shrink-0 text-xs text-gray-400">
                {new Date(thread.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
            <p className="truncate text-sm text-gray-500">{thread.preview}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
