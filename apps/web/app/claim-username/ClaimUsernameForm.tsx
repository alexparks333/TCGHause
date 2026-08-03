"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";

export default function ClaimUsernameForm({ nextPath }: { nextPath: string }) {
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const usernameStatus = useUsernameAvailability(username);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (usernameStatus !== "available") {
      setError("Choose an available username before continuing.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/me/username", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set username.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
        Username
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
          className="rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
          placeholder="How other buyers/sellers will see you"
        />
        {usernameStatus === "checking" && (
          <span className="text-xs text-gray-500">Checking availability…</span>
        )}
        {usernameStatus === "taken" && (
          <span className="text-xs text-brand-urgent">That username is taken.</span>
        )}
        {usernameStatus === "invalid" && username.length > 0 && (
          <span className="text-xs text-brand-urgent">
            3-20 letters, numbers, or underscores.
          </span>
        )}
        {usernameStatus === "available" && (
          <span className="text-xs text-green-600">Username is available.</span>
        )}
      </label>

      {error && <p className="text-sm text-brand-urgent">{error}</p>}

      <button
        type="submit"
        disabled={submitting || usernameStatus !== "available"}
        className="mt-2 rounded-full bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
      >
        {submitting ? "Saving..." : "Continue"}
      </button>
    </form>
  );
}
