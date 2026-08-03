"use client";

import type { FormEvent } from "react";
import type { WizardData, UpdateField } from "../SellWizard";
import { inputClass, labelClass } from "./styles";
import { GAMES } from "@/lib/types";

const GRADING_COMPANIES = ["PSA", "BGS", "CGC"];
const CONDITIONS = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];

export default function Step1Details({
  data,
  update,
  onNext,
}: {
  data: WizardData;
  update: UpdateField;
  onNext: () => void;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onNext();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Describe the card</h2>
        <p className="text-sm text-gray-500">
          Only the title is required to continue — the rest can be filled in now or refined later.
        </p>
      </div>

      <label className={labelClass}>
        Title
        <input
          required
          value={data.title}
          onChange={(e) => update("title", e.target.value)}
          className={inputClass}
          placeholder="Charizard VMAX Rainbow Rare - Champion's Path"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className={labelClass}>
          Game
          <select
            value={data.game}
            onChange={(e) => update("game", e.target.value)}
            className={inputClass}
          >
            {GAMES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Set (optional)
          <input
            value={data.setName}
            onChange={(e) => update("setName", e.target.value)}
            className={inputClass}
            placeholder="Champion's Path"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className={labelClass}>
          Card number (optional)
          <input
            value={data.cardNumber}
            onChange={(e) => update("cardNumber", e.target.value)}
            className={inputClass}
            placeholder="074/073"
          />
        </label>
        <label className={labelClass}>
          Rarity (optional)
          <input
            value={data.rarity}
            onChange={(e) => update("rarity", e.target.value)}
            className={inputClass}
            placeholder="Secret Rare"
          />
        </label>
      </div>

      <label className={labelClass}>
        Condition (optional)
        <select
          value={data.condition}
          onChange={(e) => update("condition", e.target.value)}
          className={inputClass}
        >
          <option value="">Select condition</option>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={data.isGraded}
          onChange={(e) => update("isGraded", e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 accent-brand-navy"
        />
        This card is professionally graded
      </label>

      {data.isGraded && (
        <div className="grid grid-cols-3 gap-4 rounded-lg bg-brand-surface p-3">
          <label className={labelClass}>
            Grading company
            <select
              value={data.gradingCompany}
              onChange={(e) => update("gradingCompany", e.target.value)}
              className={inputClass}
            >
              {GRADING_COMPANIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Grade
            <input
              value={data.grade}
              onChange={(e) => update("grade", e.target.value)}
              className={inputClass}
              placeholder="10"
            />
          </label>
          <label className={labelClass}>
            Cert number
            <input
              value={data.certNumber}
              onChange={(e) => update("certNumber", e.target.value)}
              className={inputClass}
              placeholder="88401552"
            />
          </label>
        </div>
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="submit"
          className="rounded-full bg-brand-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light"
        >
          Continue to photos
        </button>
      </div>
    </form>
  );
}
