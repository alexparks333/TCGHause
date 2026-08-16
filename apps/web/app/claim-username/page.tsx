import { redirect } from "next/navigation";
import { getLocalSession } from "@/lib/session";
import { getMe } from "@/lib/api";
import ClaimUsernameForm from "./ClaimUsernameForm";

export default async function ClaimUsernamePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextPath = next || "/";

  // Just the token — apps/api's own /me endpoint independently verifies
  // the JWT, so there's nothing to gain from a slower verified
  // getCurrentSession() call just to redirect an actually-logged-out user.
  const local = await getLocalSession();
  if (!local) {
    redirect("/login");
  }

  const me = await getMe(local.accessToken).catch(() => null);
  if (me?.username) {
    // Already claimed — don't show the form again.
    redirect(nextPath);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-surface px-4">
      <div className="w-full max-w-sm rounded-xl border border-brand-border bg-white p-6">
        <h1 className="text-lg font-bold text-gray-900">Choose a username</h1>
        <p className="mt-1 text-sm text-gray-500">
          This is how other buyers and sellers will see you — on your listings, in
          messages, everywhere. You can change it later in Account Settings.
        </p>
        <ClaimUsernameForm nextPath={nextPath} />
      </div>
    </div>
  );
}
