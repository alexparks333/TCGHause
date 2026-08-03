// Next's async searchParams prop shape — a value can be a single string, an
// array (repeated key), or absent. This app never emits a repeated-key
// param itself, so paramStr always takes the first value for consistency.
export type SearchParams = Record<string, string | string[] | undefined>;

export function paramStr(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function paramNum(params: SearchParams, key: string): number | undefined {
  const v = paramStr(params, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export function paramBool(params: SearchParams, key: string): boolean {
  return paramStr(params, key) === "true";
}

// Builds a `/?...` href from the current params with the given overrides
// applied (a value of undefined removes that key) — the general "clear this
// one filter, keep every other one" and "carry every filter forward when
// changing just one" mechanism shared by CategoryNav, the header search
// box, and FilterSidebar (CLAUDE.md §6.14/§6.15). Without this, every new
// filter added would require updating every other filter control's
// link-building logic by hand to keep them all composable.
export function hrefWithParams(
  params: SearchParams,
  overrides: Record<string, string | undefined>,
): string {
  const next = new URLSearchParams();
  for (const key of Object.keys(params)) {
    if (key in overrides) continue;
    const v = paramStr(params, key);
    if (v) next.set(key, v);
  }
  for (const [key, v] of Object.entries(overrides)) {
    if (v) next.set(key, v);
  }
  const qs = next.toString();
  return qs ? `/?${qs}` : "/";
}
