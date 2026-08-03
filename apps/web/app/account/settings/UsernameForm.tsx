"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";

export default function UsernameForm({ currentUsername }: { currentUsername: string | null }) {
  const [editing, setEditing] = useState(!currentUsername);
  const [username, setUsername] = useState(currentUsername ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const usernameStatus = useUsernameAvailability(username, currentUsername ?? undefined);
  const router = useRouter();

  const unchanged = username === currentUsername;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!unchanged && usernameStatus !== "available") {
      setError("Choose an available username before saving.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/me/username", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update username.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-brand-surface px-3 py-2">
        <p className="truncate text-sm font-medium text-gray-900">{currentUsername}</p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-sm font-medium text-brand-navy hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          required
          minLength={3}
          maxLength={20}
          pattern="[a-zA-Z0-9_]+"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="flex-1 rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
          placeholder="Choose a username"
        />
        <button
          type="submit"
          disabled={submitting || (!unchanged && usernameStatus !== "available")}
          className="shrink-0 rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
        >
          {submitting ? "Saving..." : "Save"}
        </button>
        {currentUsername && (
          <button
            type="button"
            onClick={() => {
              setUsername(currentUsername);
              setEditing(false);
              setError("");
            }}
            className="shrink-0 text-sm text-gray-500 hover:underline"
          >
            Cancel
          </button>
        )}
      </div>
      {!unchanged && usernameStatus === "checking" && (
        <span className="text-xs text-gray-500">Checking availability…</span>
      )}
      {!unchanged && usernameStatus === "taken" && (
        <span className="text-xs text-brand-urgent">That username is taken.</span>
      )}
      {!unchanged && usernameStatus === "invalid" && username.length > 0 && (
        <span className="text-xs text-brand-urgent">3-20 letters, numbers, or underscores.</span>
      )}
      {!unchanged && usernameStatus === "available" && (
        <span className="text-xs text-green-600">Username is available.</span>
      )}
      {error && <p className="text-xs text-brand-urgent">{error}</p>}
    </form>
  );
}
