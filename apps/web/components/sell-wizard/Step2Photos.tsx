"use client";

import PhotoSlot from "./PhotoSlot";
import type { WizardData, UpdateField } from "../SellWizard";

export default function Step2Photos({
  data,
  update,
  onNext,
  onBack,
}: {
  data: WizardData;
  update: UpdateField;
  onNext: () => void;
  onBack: () => void;
}) {
  const canProceed = Boolean(data.photoFront || data.photoBack);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Add photos</h2>
        <p className="text-sm text-gray-500">
          Clear, well-lit photos build buyer trust and cut down on condition disputes.
          At least one photo is required — both sides is better.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <PhotoSlot
          label="Front of card"
          hint="Straight-on, good lighting"
          url={data.photoFront}
          onUploaded={(url) => update("photoFront", url)}
          onRemoved={() => update("photoFront", null)}
        />
        <PhotoSlot
          label="Back of card"
          hint="Show the full back"
          url={data.photoBack}
          onUploaded={(url) => update("photoBack", url)}
          onRemoved={() => update("photoBack", null)}
        />
        {data.isGraded && (
          <PhotoSlot
            label="Certification label"
            hint="Close-up of the grading label"
            url={data.photoCert}
            onUploaded={(url) => update("photoCert", url)}
            onRemoved={() => update("photoCert", null)}
          />
        )}
      </div>

      <div className="mt-2 flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-gray-300 px-6 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-brand-surface"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!canProceed}
          onClick={onNext}
          className="rounded-full bg-brand-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue to price
        </button>
      </div>
    </div>
  );
}
