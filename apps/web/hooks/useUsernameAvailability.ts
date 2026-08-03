"use client";

import { useEffect, useState } from "react";
import { checkUsernameAvailable } from "@/lib/api";
import { useDebouncedValue } from "./useDebouncedValue";

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

// Shared by SignUpForm, ClaimUsernameForm, and Account Settings' username
// editor — all three need the same "type a candidate, debounce, check
// availability" behavior. `skipValue` lets a settings form pass its own
// current username so re-typing your existing name doesn't flag as taken.
export function useUsernameAvailability(username: string, skipValue?: string): UsernameStatus {
  const debounced = useDebouncedValue(username, 400);
  const [status, setStatus] = useState<UsernameStatus>("idle");

  useEffect(() => {
    if (debounced === "") {
      setStatus("idle");
      return;
    }
    if (skipValue && debounced === skipValue) {
      setStatus("idle");
      return;
    }
    if (!USERNAME_PATTERN.test(debounced)) {
      setStatus("invalid");
      return;
    }

    let cancelled = false;
    setStatus("checking");
    checkUsernameAvailable(debounced)
      .then((available) => {
        if (!cancelled) setStatus(available ? "available" : "taken");
      })
      .catch(() => {
        if (!cancelled) setStatus("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, skipValue]);

  return status;
}
