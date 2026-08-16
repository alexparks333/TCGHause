import { redirect } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AccountTabs from "@/components/AccountTabs";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCurrentSession } from "@/lib/session";
import { getMyThreads } from "@/lib/api";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  // getCurrentSession() is cache()'d — Header (rendered below) and every
  // page nested under this layout call it too, so this shares that one
  // call instead of paying for a separate round trip to Supabase's Auth
  // server just to check login.
  const { session, user } = await getCurrentSession();

  if (!user || !session) {
    redirect("/login");
  }

  // Header fetches this same endpoint for its own AccountMenu badge — both
  // calls hit the Go API independently (no shared request cache across
  // Header and this layout the way getMe/getCurrentSession are cache()'d),
  // but it's one cheap indexed query, same tradeoff as every other
  // Header-adjacent fetch in this codebase.
  const unreadMessageCount = await getMyThreads(session.access_token)
    .then((m) => m.unreadCount)
    .catch(() => 0);

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <AccountTabs unreadMessageCount={unreadMessageCount} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
