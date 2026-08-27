"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import StepBubbles from "./StepBubbles";
import CardSearch from "./sell-wizard/CardSearch";
import Step1Details from "./sell-wizard/Step1Details";
import Step2Photos from "./sell-wizard/Step2Photos";
import Step3Price from "./sell-wizard/Step3Price";
import { apiFetch } from "@/lib/api";
import type { ShippingPreset } from "@/lib/types";

export interface WizardData {
  title: string;
  game: string;
  setName: string;
  cardNumber: string;
  rarity: string;
  condition: string;
  isGraded: boolean;
  gradingCompany: string;
  grade: string;
  certNumber: string;
  // Ordered list, up to 10 — position 0 is the cover photo (what
  // ListingImage/ListingCard/ListingRow all render as imageUrls[0]
  // everywhere on the site), the rest follow in whatever order the
  // seller drags them into in Step2Photos. Replaces the old fixed
  // photoFront/photoBack/photoCert trio — which side is which, and any
  // corner-detail photos, is a labeling step to design later; for now
  // this is just "the photos, in the order the seller wants them shown."
  photos: string[];
  format: "auction" | "fixed";
  price: string;
  startingBid: string;
  durationMinutes: number;
  // Optional "Buy It Now" price alongside an auction — CLAUDE.md's "Auction,
  // Buy It Now, or Both": auction alone is buyItNowEnabled=false; "both" is
  // buyItNowEnabled=true with a real buyItNowPrice. Only meaningful when
  // format === "auction" — fixed-price listings already are Buy It Now only,
  // their own `price` field is the BIN price.
  buyItNowEnabled: boolean;
  buyItNowPrice: string;
  // ShippingPreset is the seller's chosen shipping method (see
  // Step3Price's picker) — a floor, not a guarantee: the backend
  // re-derives the required mechanism from the actual final sale price at
  // order time and ships at whichever is stricter
  // (internal/shipping.UpgradePreset) — a low-starting-bid auction that
  // closes above $100 always ships via a tracked package regardless of
  // what's picked here. The three free_* presets are only valid on
  // fixed-price listings under $100 — Step3Price hides them otherwise.
  shippingPreset: ShippingPreset;
}

export type UpdateField = <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;

const INITIAL: WizardData = {
  title: "",
  game: "Pokémon",
  setName: "",
  cardNumber: "",
  rarity: "",
  condition: "",
  isGraded: false,
  gradingCompany: "PSA",
  grade: "",
  certNumber: "",
  photos: [],
  format: "auction",
  price: "",
  startingBid: "",
  durationMinutes: 7 * 24 * 60,
  buyItNowEnabled: false,
  buyItNowPrice: "",
  shippingPreset: "tracked_envelope",
};

function dollarsToCents(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

export default function SellWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const update: UpdateField = (key, value) => setData((d) => ({ ...d, [key]: value }));

  async function handleSubmit() {
    if (
      data.format === "auction" &&
      data.buyItNowEnabled &&
      dollarsToCents(data.buyItNowPrice) <= dollarsToCents(data.startingBid)
    ) {
      setError("Buy It Now price must be higher than the starting bid.");
      return;
    }

    // Mirrors apps/api/internal/listing.Create's own validation — checked
    // here too so the seller sees this before submitting, not just as a
    // server error after the fact. The server re-checks regardless; this
    // is a UX nicety, not the actual enforcement. Only a known (fixed)
    // price that's already too high for envelope shipping is rejected
    // here — an auction's final price isn't known yet, so both
    // free_envelope and tracked_envelope stay valid there (the backend
    // resolves the real mechanism at sale time).
    const isLetterMechanism = data.shippingPreset === "free_envelope" || data.shippingPreset === "tracked_envelope";
    if (isLetterMechanism && data.format === "fixed" && dollarsToCents(data.price) >= 10000) {
      setError("Envelope shipping isn't available on listings priced at $100 or more.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const listing = await apiFetch("/listings", {
        method: "POST",
        body: JSON.stringify({
          title: data.title,
          game: data.game,
          set: data.setName,
          cardNumber: data.cardNumber,
          rarity: data.rarity,
          condition: data.condition,
          isGraded: data.isGraded,
          gradingCompany: data.isGraded ? data.gradingCompany : "",
          grade: data.isGraded ? data.grade : "",
          certNumber: data.isGraded ? data.certNumber : "",
          format: data.format,
          priceCents: data.format === "fixed" ? dollarsToCents(data.price) : 0,
          startingBidCents: data.format === "auction" ? dollarsToCents(data.startingBid) : 0,
          durationMinutes: data.format === "auction" ? data.durationMinutes : 0,
          buyItNowPriceCents:
            data.format === "auction" && data.buyItNowEnabled
              ? dollarsToCents(data.buyItNowPrice)
              : 0,
          shippingPreset: data.shippingPreset,
          imageUrls: data.photos,
        }),
      });
      router.push(`/listing/${listing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-8">
      <StepBubbles current={step} onStepClick={(target) => target < step && setStep(target)} />

      <div className="mt-10 flex flex-col gap-4">
        {step === 1 && <CardSearch game={data.game} update={update} />}

        <div
          key={step}
          className="animate-step-enter rounded-2xl border border-gray-300 bg-white p-6 shadow-sm sm:p-8"
        >
          {step === 1 && (
            <Step1Details data={data} update={update} onNext={() => setStep(2)} />
          )}
          {step === 2 && (
            <Step2Photos
              data={data}
              update={update}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <Step3Price
              data={data}
              update={update}
              onBack={() => setStep(2)}
              onSubmit={handleSubmit}
              submitting={submitting}
              error={error}
            />
          )}
        </div>
      </div>
    </div>
  );
}
