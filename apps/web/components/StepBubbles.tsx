import { Check } from "lucide-react";

const STEPS = ["Details", "Photos", "Price"];

export default function StepBubbles({
  current,
  onStepClick,
}: {
  current: number;
  // Only steps already reached (done or the current one) are clickable —
  // jumping ahead to an unfilled step would skip that step's own required-
  // field validation (e.g. Step1's title), so "back to a previous step"
  // only, same convention most wizards use for their own breadcrumbs.
  onStepClick?: (step: number) => void;
}) {
  return (
    <div className="flex items-center justify-center">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const state = step < current ? "done" : step === current ? "active" : "upcoming";
        const clickable = step <= current && step !== current && Boolean(onStepClick);

        return (
          <div key={label} className="flex items-center">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onStepClick?.(step)}
              aria-label={`Go to step ${step}: ${label}`}
              className={`flex flex-col items-center gap-2 rounded-lg ${
                clickable ? "cursor-pointer" : state === "active" ? "cursor-default" : "cursor-not-allowed"
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-all duration-300 ${
                  state === "done"
                    ? `bg-brand-navy text-white ${clickable ? "hover:bg-brand-navy-light" : ""}`
                    : state === "active"
                      ? "scale-110 bg-brand-gold text-white shadow-lg shadow-brand-gold/30"
                      : "border border-gray-300 bg-white text-gray-400"
                }`}
              >
                {state === "done" ? (
                  <Check size={17} className="animate-pop-in" />
                ) : (
                  step
                )}
              </div>
              <span
                className={`text-xs font-medium transition-colors duration-300 ${
                  state === "upcoming" ? "text-gray-400" : "text-gray-800"
                }`}
              >
                {label}
              </span>
            </button>
            {step < STEPS.length && (
              <div className="relative mx-3 mb-5 h-0.5 w-12 shrink-0 overflow-hidden rounded-full bg-gray-200 sm:w-24">
                <div
                  className="absolute inset-y-0 left-0 bg-brand-navy transition-all duration-500 ease-out"
                  style={{ width: step < current ? "100%" : "0%" }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
