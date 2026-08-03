"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function BioForm({ currentBio }: { currentBio: string | null }) {
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(currentBio ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await apiFetch("/me/bio", {
        method: "POST",
        body: JSON.stringify({ bio }),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update bio.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg bg-brand-surface px-3 py-2">
        <p className="whitespace-pre-wrap text-sm text-gray-900">
          {currentBio || <span className="text-gray-400">No bio yet.</span>}
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-sm font-medium text-brand-navy hover:underline"
        >
          {currentBio ? "Change" : "Add bio"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        maxLength={500}
        rows={4}
        autoFocus
        className="rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
        placeholder="Tell buyers a bit about yourself"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
        >
          {submitting ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setBio(currentBio ?? "");
            setEditing(false);
            setError("");
          }}
          className="text-sm text-gray-500 hover:underline"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-brand-urgent">{error}</p>}
    </form>
  );
}
