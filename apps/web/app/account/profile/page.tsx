import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";
import { getMe } from "@/lib/api";

// Editing the profile canvas now happens in place, on the live profile
// itself (app/seller/[username]/page.tsx's owner-only "Edit Profile"
// button) — there's no separate builder page anymore. This route just
// stays as a stable landing spot for AccountMenu/AccountTabs' "Profile"
// link, since neither of those knows the caller's username directly.
export default async function AccountProfileRedirect() {
  const { session } = await getCurrentSession();
  const me = session ? await getMe(session.access_token).catch(() => null) : null;
  redirect(me?.username ? `/seller/${me.username}` : "/claim-username");
}
