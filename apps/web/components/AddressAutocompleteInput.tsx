"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { autocompleteAddress, resolveAddressSuggestion, type ResolvedAddress } from "@/lib/api";

// Drop-in replacement for a plain "Address line 1" <input> — types the same
// props, so swapping it in doesn't touch the surrounding form. Suggests
// real, USPS-known addresses as the caller types (Google Places under the
// hood, internal/address.AutocompleteClient) and, on selection, hands back
// the rest of the address (city/state/postalCode/country) via onResolve so
// the caller can fill those fields in too — the whole point is to stop
// free-text typos from ever reaching Pitney Bowes' stricter validation in
// the first place, not just to be a nicer-looking input.
//
// If the backend doesn't have GOOGLE_PLACES_API_KEY configured,
// autocompleteAddress always resolves to [] — this just quietly behaves
// like a plain text input, no error state, no visual difference.
export default function AddressAutocompleteInput({
  value,
  onChange,
  onResolve,
  placeholder,
  className,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  onResolve: (resolved: ResolvedAddress) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<{ placeId: string; text: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const requestId = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value.trim() || value.trim().length < 4) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const id = ++requestId.current;
    const timeout = setTimeout(() => {
      autocompleteAddress(value).then((results) => {
        if (id !== requestId.current) return;
        setSuggestions(results);
        setOpen(results.length > 0);
        setHighlighted(0);
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function selectSuggestion(placeId: string, text: string) {
    setOpen(false);
    onChange(text.split(",")[0] ?? text);
    try {
      const resolved = await resolveAddressSuggestion(placeId);
      onResolve(resolved);
    } catch {
      // Best-effort — the caller still typed something reasonable into
      // line1 even if the detail lookup failed.
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && suggestions[highlighted]) {
            e.preventDefault();
            selectSuggestion(suggestions[highlighted].placeId, suggestions[highlighted].text);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-brand-border bg-white shadow-md">
          {suggestions.map((s, i) => (
            <li key={s.placeId}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectSuggestion(s.placeId, s.text)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm ${
                  i === highlighted ? "bg-brand-surface" : "hover:bg-brand-surface"
                }`}
              >
                <MapPin size={14} className="mt-0.5 shrink-0 text-gray-400" />
                <span className="text-gray-900">{s.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
