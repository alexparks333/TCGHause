import { notFound } from "next/navigation";
import DevQuickListForm from "./DevQuickListForm";

// Dev-only, no-photo listing creation: type a title and pick auction,
// fixed-price (Buy It Now only), or auction + a Buy It Now price ("Both"),
// skip the Sell wizard's photo-upload steps entirely. Backed by
// internal/listing.Create's AllowMissingPhotos (apps/api),
// itself gated on APP_ENV the same way as the short dev auction durations
// — a listing created here has an empty imageUrls, which ListingImage/
// CardArt already render as the gradient-with-title placeholder (the same
// look the very first "Charizard VMAX (TEST)" listings had, before real
// photo upload existed). 404s outside development, same belt-and-
// suspenders gating as DevQuickSwitch/switch-user.
export default function DevQuickListPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-lg font-bold text-gray-900">Dev · Quick list</h1>
      <p className="mt-1 text-sm text-gray-500">
        Creates a real listing with no photos — auction, fixed-price Buy It Now, or an
        auction with a Buy It Now price added. Renders with the gradient placeholder card art.
      </p>
      <DevQuickListForm />
    </div>
  );
}
