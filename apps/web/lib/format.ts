// Shared by NotificationBell and the Messages inbox — both render a list of
// timestamped items newest-first and want the same "12m ago" / "3d ago"
// shorthand rather than a full date.
export function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// The exact moment something happened — "Aug 15, 2026, 6:39 PM" — distinct
// from formatRelativeTime's rough shorthand. Used where the precise
// timestamp itself is the point (a Sold-filtered listing's sale time), not
// just a sense of how long ago it was.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// A review/rating count next to a star row has no room for "(100,506)" —
// this is the "(1.1k)"/"(100.5k)" shorthand once it crosses 1000, one
// decimal place, no trailing ".0" (2000 -> "2k", not "2.0k").
export function formatCompactCount(n: number): string {
  if (n < 1000) return String(n);
  const thousands = Math.round((n / 1000) * 10) / 10;
  return `${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
}
