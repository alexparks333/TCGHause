"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Lock, Gavel } from "lucide-react";
import ListingImage from "@/components/ListingImage";
import MoneyInput from "@/components/sell-wizard/MoneyInput";
import ShippingPresetPicker from "@/components/sell-wizard/ShippingPresetPicker";
import SortablePhotoGrid from "@/components/sell-wizard/SortablePhotoGrid";
import { inputClass, labelClass } from "@/components/sell-wizard/styles";
import { updateListing, ApiError } from "@/lib/api";
import { formatPrice, shippingMethodLabel, shippingCostLabel, type Listing, type ShippingPreset } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

// Modeled directly on eBay's own real "revise a listing" rules (researched
// against eBay's seller help/developer docs, not guessed):
//
//   - Fixed-price ("Buy It Now only," no auction): price moves up or down,
//     shipping is fully editable, any time before it sells — "a regular
//     person selling it," nothing auction-shaped to protect.
//   - Auction, no bids yet: starting bid and Buy It Now price can only be
//     LOWERED (never raised) or removed — eBay's revise is decrease-only,
//     same reasoning both places (a buyer who's seen the listing shouldn't
//     have the price quietly raised on them). Shipping stays editable.
//   - Auction, one or more bids: nothing is editable, full stop — real
//     eBay locks price and shipping the instant a bid lands, and (for a
//     non-reserve auction) Buy It Now disappears from the listing
//     entirely at that same moment. This app mirrors both: internal/
//     auction.PlaceBid clears buy_it_now_price_cents on the first bid
//     (which is why listing.buyItNowPriceCents is already gone by the
//     time this form ever sees a bid-having auction), and internal/
//     listing.Update rejects any attempted change outright (ErrHasBids).
//
// Photos, and the card-identity fields (title/set/card number/rarity),
// follow the exact same editable/locked split as price and shipping — add,
// change, or reorder freely (SortablePhotoGrid, same component the Sell
// wizard uses) right up until the same moment everything else locks. Every
// real photo change is logged server-side (internal/listing.PhotoHistory)
// for claim review, invisible here — nothing in this form needs to know the
// log exists. Game and Condition still never change through this form.
//
// Laid out as a left-side tab switcher (Details / Price / Photos, mirroring
// the Sell wizard's own three-step shape) rather than one long scroll — all
// three tabs' state lives in this one component regardless of which is
// active, so switching tabs never loses an in-progress edit, and Save
// commits every tab's changes together in one PATCH, not per-tab.
type Tab = "details" | "price" | "photos";

export default function EditListingForm({ listing }: { listing: Listing }) {
  const router = useRouter();
  const isFixed = listing.format === "fixed";
  const hasBids = Boolean(listing.bidCount && listing.bidCount > 0);
  // Auction + no bids is the only state anything about price/shipping is
  // still editable for an auction — everywhere else in this file gates on
  // this one flag rather than re-deriving it.
  const auctionEditable = !isFixed && !hasBids;
  const editable = isFixed || auctionEditable;

  const [activeTab, setActiveTab] = useState<Tab>("details");

  const [title, setTitle] = useState(listing.title);
  const [setName, setSetName] = useState(listing.set ?? "");
  const [cardNumber, setCardNumber] = useState(listing.cardNumber ?? "");
  const [rarity, setRarity] = useState(listing.rarity ?? "");

  const [startingBid, setStartingBid] = useState(
    listing.startingBidCents ? (listing.startingBidCents / 100).toFixed(2) : "",
  );
  const [price, setPrice] = useState(
    isFixed
      ? ((listing.priceCents ?? 0) / 100).toFixed(2)
      : listing.buyItNowPriceCents
        ? (listing.buyItNowPriceCents / 100).toFixed(2)
        : "",
  );
  const [buyItNowEnabled, setBuyItNowEnabled] = useState(Boolean(listing.buyItNowPriceCents));
  const [shippingPreset, setShippingPreset] = useState<ShippingPreset>(listing.shippingPreset);
  const [allowOffers, setAllowOffers] = useState(listing.allowOffers);
  const [minOffer, setMinOffer] = useState(
    listing.minOfferCents ? (listing.minOfferCents / 100).toFixed(2) : "",
  );
  const [photos, setPhotos] = useState<string[]>(listing.imageUrls ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const titleMissing = editable && title.trim() === "";

  const startingBidCents = Math.round(Number.parseFloat(startingBid || "0") * 100);
  const originalStartingBidCents = listing.startingBidCents ?? 0;
  const startingBidTooHigh =
    !isFixed && startingBid.trim() !== "" && originalStartingBidCents > 0 && startingBidCents > originalStartingBidCents;

  const offersEligible = isFixed || buyItNowEnabled;
  const binPriceCents = isFixed || buyItNowEnabled ? Math.round(Number.parseFloat(price || "0") * 100) : 0;
  const hasBinPrice = binPriceCents > 0;
  const originalBinCents = listing.buyItNowPriceCents ?? 0;
  const binTooHigh =
    !isFixed && buyItNowEnabled && hasBinPrice && originalBinCents > 0 && binPriceCents > originalBinCents;
  const binNotAboveStartingBid =
    !isFixed && buyItNowEnabled && hasBinPrice && startingBidCents > 0 && binPriceCents <= startingBidCents;

  const minOfferCents = Math.round(Number.parseFloat(minOffer || "0") * 100);
  const minOfferTooHigh = hasBinPrice && minOffer.trim() !== "" && minOfferCents >= binPriceCents;

  // Per-tab error flags — drives the small red dot on each tab button, so
  // switching away from a tab with an unresolved field error doesn't just
  // silently disable Save with no visible reason.
  const detailsTabHasError = titleMissing;
  const priceTabHasError = startingBidTooHigh || binTooHigh || binNotAboveStartingBid || minOfferTooHigh;
  const photosTabHasError = photos.length === 0;

  const canSubmit = !detailsTabHasError && !priceTabHasError && !photosTabHasError;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      await updateListing(listing.id, {
        title,
        set: setName,
        cardNumber,
        rarity,
        priceCents: isFixed ? binPriceCents : buyItNowEnabled ? binPriceCents : 0,
        allowOffers,
        minOfferCents: allowOffers ? minOfferCents : 0,
        startingBidCents: auctionEditable ? startingBidCents : undefined,
        shippingPreset,
        imageUrls: photos,
      });
      router.push("/account/selling");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      <Link
        href={`/listing/${listing.id}`}
        className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 transition-colors hover:border-brand-navy hover:bg-brand-surface"
      >
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg">
          <ListingImage src={listing.imageUrls?.[0]} game={listing.game} label={listing.title} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{listing.title}</p>
          <p className="text-xs text-gray-500">
            {listing.set}
            {listing.isGraded ? ` · ${listing.gradingCompany} ${listing.grade}` : ` · ${listing.condition}`}
          </p>
        </div>
      </Link>

      {!isFixed && (
        <ReadOnlySection title="Auction status">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ReadOnlyField label="Bids" value={String(listing.bidCount ?? 0)} />
            <ReadOnlyField label="Current bid" value={formatPrice(listing.currentPriceCents ?? 0)} />
            <ReadOnlyField
              label="Ends"
              value={
                listing.endsAt
                  ? new Date(listing.endsAt).getTime() <= Date.now()
                    ? "Ended"
                    : formatDateTime(listing.endsAt)
                  : "—"
              }
            />
          </div>
          {hasBids ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-brand-urgent">
              <Gavel size={12} /> This auction has a bid — everything below is locked for good.
            </p>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
              <Lock size={12} /> Auction length can&apos;t change once a listing is live. The
              starting bid can still be lowered below — but never raised — up until the first bid
              comes in.
            </p>
          )}
        </ReadOnlySection>
      )}

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
        <nav className="flex gap-2 overflow-x-auto sm:w-40 sm:shrink-0 sm:flex-col sm:gap-1 sm:overflow-visible">
          <TabButton label="Details" active={activeTab === "details"} hasError={detailsTabHasError} onClick={() => setActiveTab("details")} />
          <TabButton label="Price" active={activeTab === "price"} hasError={priceTabHasError} onClick={() => setActiveTab("price")} />
          <TabButton label="Photos" active={activeTab === "photos"} hasError={photosTabHasError} onClick={() => setActiveTab("photos")} />
        </nav>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-5">
          {activeTab === "details" &&
            (editable ? (
              <FormSection title="Card details">
                <label className={labelClass}>
                  Title
                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className={inputClass}
                  />
                  {titleMissing && <span className="text-xs text-brand-urgent">Title is required.</span>}
                </label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className={labelClass}>
                    Set
                    <input
                      value={setName}
                      onChange={(e) => setSetName(e.target.value)}
                      className={inputClass}
                      placeholder="Champion's Path"
                    />
                  </label>
                  <label className={labelClass}>
                    Card number
                    <input
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      className={inputClass}
                      placeholder="074/073"
                    />
                  </label>
                </div>
                <div className="mt-3">
                  <label className={labelClass}>
                    Rarity
                    <input
                      value={rarity}
                      onChange={(e) => setRarity(e.target.value)}
                      className={inputClass}
                      placeholder="Secret Rare"
                    />
                  </label>
                </div>
              </FormSection>
            ) : (
              <ReadOnlySection title="Card details">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <ReadOnlyField label="Title" value={listing.title} />
                  <ReadOnlyField label="Set" value={listing.set || "—"} />
                  <ReadOnlyField label="Card number" value={listing.cardNumber || "—"} />
                  <ReadOnlyField label="Rarity" value={listing.rarity || "—"} />
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
                  <Lock size={12} /> Locked now that this auction has a bid.
                </p>
              </ReadOnlySection>
            ))}

          {activeTab === "price" && (
            <>
              {auctionEditable && (
                <FormSection title="Starting bid">
                  <MoneyInput
                    label="Amount"
                    required
                    value={startingBid}
                    onChange={setStartingBid}
                    placeholder="5.00"
                    error={
                      startingBidTooHigh
                        ? `Can only be lowered, not raised — was ${formatPrice(originalStartingBidCents)}.`
                        : undefined
                    }
                  />
                </FormSection>
              )}

              {editable && (
                <FormSection title={isFixed ? "Price" : "Buy It Now"} optional={!isFixed}>
                  {!isFixed && (
                    <>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <input
                          type="checkbox"
                          checked={buyItNowEnabled}
                          onChange={(e) => setBuyItNowEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 accent-brand-navy"
                        />
                        Allow Buy It Now Price
                      </label>
                      <p className="mt-1 text-xs text-gray-500">
                        Buyers can buy it instantly at a set price before the first bid.{" "}
                        {originalBinCents > 0 && "Once set, it can only be lowered or removed — never raised."}
                      </p>
                    </>
                  )}

                  {(isFixed || buyItNowEnabled) && (
                    <div className={isFixed ? "" : "mt-3"}>
                      <MoneyInput
                        label={isFixed ? "Price" : "Buy It Now price"}
                        required
                        value={price}
                        onChange={setPrice}
                        placeholder={isFixed ? "24.99" : "49.99"}
                        error={
                          binTooHigh
                            ? `Can only be lowered, not raised — was ${formatPrice(originalBinCents)}.`
                            : binNotAboveStartingBid
                              ? "Must be greater than the starting bid."
                              : undefined
                        }
                      />
                    </div>
                  )}
                </FormSection>
              )}

              {!isFixed && hasBids && (
                <ReadOnlySection title="Buy It Now">
                  <p className="text-sm text-gray-600">
                    No longer available — Buy It Now disappears from an auction the moment it gets
                    its first bid, same as eBay.
                  </p>
                </ReadOnlySection>
              )}

              {offersEligible && (
                <FormSection title="Offers" optional>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      checked={allowOffers}
                      onChange={(e) => setAllowOffers(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 accent-brand-navy"
                    />
                    Allow offers{hasBinPrice ? ` below ${formatPrice(binPriceCents)}` : ""}
                  </label>
                  <p className="mt-1 text-xs text-gray-500">
                    Buyers can send a lower offer instead of paying{" "}
                    {hasBinPrice ? formatPrice(binPriceCents) : "your Buy It Now price"} outright.
                  </p>

                  {allowOffers && (
                    <div className="mt-3">
                      <MoneyInput
                        label="Minimum offer (optional)"
                        value={minOffer}
                        onChange={setMinOffer}
                        placeholder="e.g. 45.00"
                        error={
                          minOfferTooHigh
                            ? `Must be less than ${formatPrice(binPriceCents)} — that's your Buy It Now price.`
                            : undefined
                        }
                      />
                      {!minOfferTooHigh && (
                        <p className="mt-1 text-xs text-gray-500">
                          Offers below this amount can&apos;t be sent at all. Leave blank to
                          consider any offer under{" "}
                          {hasBinPrice ? formatPrice(binPriceCents) : "your Buy It Now price"}.
                        </p>
                      )}
                    </div>
                  )}
                </FormSection>
              )}

              {editable ? (
                <FormSection title="Shipping">
                  <ShippingPresetPicker
                    value={shippingPreset}
                    onChange={setShippingPreset}
                    knownPriceCents={isFixed ? binPriceCents : 0}
                    referencePriceCents={Math.max(startingBidCents, binPriceCents)}
                  />
                </FormSection>
              ) : (
                <ReadOnlySection title="Shipping">
                  <p className="text-sm text-gray-700">
                    {shippingMethodLabel(listing)} — {shippingCostLabel(listing)}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                    <Lock size={12} /> Locked now that this auction has a bid.
                  </p>
                </ReadOnlySection>
              )}
            </>
          )}

          {activeTab === "photos" &&
            (editable ? (
              <FormSection title="Photos">
                <SortablePhotoGrid photos={photos} onChange={setPhotos} />
              </FormSection>
            ) : (
              <ReadOnlySection title="Photos">
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {(listing.imageUrls ?? []).map((url, i) => (
                    <div
                      key={url + i}
                      className="relative aspect-[4/5] overflow-hidden rounded-lg border border-gray-200"
                    >
                      <Image src={url} alt={`Photo ${i + 1}`} fill className="object-cover" />
                    </div>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                  <Lock size={12} /> Locked now that this auction has a bid.
                </p>
              </ReadOnlySection>
            ))}

          {error && <p className="text-sm text-brand-urgent">{error}</p>}
          {!error && !canSubmit && (
            <p className="text-xs text-brand-urgent">Fix the highlighted tab(s) before saving.</p>
          )}

          <div className="mt-2 flex justify-between">
            <button
              type="button"
              onClick={() => router.push("/account/selling")}
              className="rounded-full border border-gray-300 px-6 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-brand-surface"
            >
              Cancel
            </button>
            {editable && (
              <button
                type="submit"
                disabled={saving || !canSubmit}
                className="rounded-full bg-brand-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  hasError,
  onClick,
}: {
  label: string;
  active: boolean;
  hasError: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative shrink-0 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors sm:shrink ${
        active ? "bg-brand-navy text-white" : "text-gray-600 hover:bg-brand-surface"
      }`}
    >
      {label}
      {hasError && (
        <span
          className={`absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${
            active ? "bg-white" : "bg-brand-urgent"
          }`}
        />
      )}
    </button>
  );
}

// Same visual shell as Step3Price's own FormSection (a bordered card per
// pricing concern) — kept as a near-duplicate rather than importing
// Step3Price's private copy, since that one lives inside components/
// sell-wizard as an implementation detail of the wizard, not a shared export.
function FormSection({
  title,
  optional,
  children,
}: {
  title: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900">
        {title}
        {optional && <span className="ml-1.5 font-normal text-gray-400">(optional)</span>}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// The locked equivalent of FormSection — same card shell, but every field
// inside is plain text, never an input, so nothing here could be mistaken
// for something a seller can click into and change.
function ReadOnlySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
