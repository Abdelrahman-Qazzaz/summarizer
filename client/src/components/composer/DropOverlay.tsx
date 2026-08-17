import { Meter } from "../ui/Meter";

export function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-canvas/85">
      <div className="rounded-2xl border-2 border-dashed border-signal px-10 py-8 text-center">
        <Meter state="live" className="mx-auto h-5" />
        <p className="mt-3 text-sm font-medium">Drop to add a source</p>
        <p className="eyebrow mt-1.5 text-faint">audio · video · images</p>
      </div>
    </div>
  );
}
