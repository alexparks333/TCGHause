"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import StepBubbles from "./StepBubbles";
import Step1Details from "./sell-wizard/Step1Details";
import Step2Photos from "./sell-wizard/Step2Photos";
import Step3Price from "./sell-wizard/Step3Price";
import { apiFetch } from "@/lib/api";

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
  photoFront: string | null;
  photoBack: string | null;
  photoCert: string | null;
  format: "auction" | "fixed";
  price: string;
  startingBid: string;
  durationMinutes: number;
  freeShipping: boolean;
  shippingCost: string;
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
  photoFront: null,
  photoBack: null,
  photoCert: null,
  format: "auction",
  price: "",
  startingBid: "",
  durationMinutes: 7 * 24 * 60,
  freeShipping: true,
  shippingCost: "",
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
    setSubmitting(true);
    setError("");

    const imageUrls = [data.photoFront, data.photoBack, data.photoCert].filter(
      (u): u is string => Boolean(u),
    );

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
          freeShipping: data.freeShipping,
          shippingCostCents: data.freeShipping ? 0 : dollarsToCents(data.shippingCost),
          imageUrls,
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
      <StepBubbles current={step} />

      <div
        key={step}
        className="animate-step-enter mt-10 rounded-2xl border border-gray-300 bg-white p-6 shadow-sm sm:p-8"
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
  );
}
