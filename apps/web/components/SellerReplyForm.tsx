"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

// Exactly one reply per review (CLAUDE.md's review-system design) —
// re-submitting replaces the existing reply, so this doubles as both the
// "leave a reply" and "edit your reply" UI depending on whether
// existingReply is set.
export default function SellerReplyForm({
  username,
  reviewId,
  existingReply,
}: {
  username: string;
  reviewId: string;
  existingReply: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState(existingReply ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!reply.trim()) {
      setError("Reply cannot be empty.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/users/${encodeURIComponent(username)}/reviews/${reviewId}/reply`, {
        method: "POST",
        body: JSON.stringify({ reply }),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit reply.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-2 text-xs font-medium text-brand-navy hover:underline"
      >
        {existingReply ? "Edit your reply" : "Reply as seller"}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-2">
      <textarea
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        maxLength={1000}
        rows={2}
        autoFocus
        className="rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
        placeholder="Reply to this review"
      />
      {error && <p className="text-xs text-brand-urgent">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="self-start rounded-full bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Saving..." : "Save reply"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setReply(existingReply ?? "");
            setError("");
          }}
          className="self-start rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
