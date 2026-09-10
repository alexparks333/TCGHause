"use client";

import type { ChangeEvent } from "react";

export default function MoneyInput({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder = "0.00",
  required,
}: {
  label: string;
  hint?: string;
  // Replaces `hint` with a red validation message and turns the border/
  // focus ring red to match — e.g. Step3Price's "minimum offer can't
  // exceed the Buy It Now price" check. Only ever a live client-side
  // nicety; the actual enforcement is always the server's.
  error?: string;
  value: string; // dollars-as-string, e.g. "50.90" — same shape WizardData already stores
  onChange: (dollars: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    // Every keystroke — typed, pasted, autofilled, IME, anything — gets
    // reduced to its raw digits and re-read as a whole number of cents,
    // then reformatted to exactly 2 decimal places. That's what makes an
    // amount like "54.7887" structurally impossible to end up with (there's
    // no path that produces more than 2 decimals), and it's what gives the
    // "50.90 -> type 0 -> 509.00" shift-left behavior real money inputs
    // elsewhere use: the decimal point never moves, digits shift through it.
    const digits = e.target.value.replace(/[^0-9]/g, "");
    if (digits === "") {
      onChange("");
      return;
    }
    const cents = Math.min(Number.parseInt(digits, 10), 99_999_999); // $999,999.99 ceiling
    onChange((cents / 100).toFixed(2));
  }

  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
      {label}
      <span className="relative inline-flex w-40">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xl font-semibold text-gray-400">
          $
        </span>
        <input
          required={required}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          className={`w-full rounded-2xl border bg-white py-3.5 pl-8 pr-4 text-xl font-bold text-gray-900 shadow-sm outline-none transition-colors placeholder:font-normal placeholder:text-gray-300 focus:ring-2 ${
            error
              ? "border-brand-urgent focus:border-brand-urgent focus:ring-brand-urgent/20"
              : "border-gray-300 focus:border-brand-navy focus:ring-brand-navy/20"
          }`}
        />
      </span>
      {error ? (
        <span className="text-xs font-medium text-brand-urgent">{error}</span>
      ) : hint ? (
        <span className="text-xs font-normal text-gray-400">{hint}</span>
      ) : null}
    </label>
  );
}
