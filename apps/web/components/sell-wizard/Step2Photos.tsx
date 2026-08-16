"use client";

import { useState } from "react";
import PhoneUploadPanel from "./PhoneUploadPanel";
import SortablePhotoGrid from "./SortablePhotoGrid";
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
  const canProceed = data.photos.length > 0;
  // A stable setState reference — passed straight to PhoneUploadPanel's
  // onPhotosFound so its polling effect's dependency array stays stable
  // across Step2Photos re-renders (no inline arrow wrapper here).
  const [phonePhotos, setPhonePhotos] = useState<string[]>([]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Add photos</h2>
        <p className="mt-1 text-sm text-gray-500">
          Clear, well-lit photos build buyer trust and cut down on condition disputes. At
          least one photo is required. Drag multiple photos in at once, then drag them
          into the order you want — the first is the cover photo shown everywhere on the
          site.
        </p>
      </div>

      <PhoneUploadPanel onPhotosFound={setPhonePhotos} />

      <SortablePhotoGrid
        photos={data.photos}
        onChange={(photos) => update("photos", photos)}
        externalPhotos={phonePhotos}
      />

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
