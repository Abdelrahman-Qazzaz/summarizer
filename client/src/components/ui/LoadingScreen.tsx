import { Meter } from "./Meter";

export function LoadingScreen({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <Meter state="live" className="h-5" />
      <p className="eyebrow text-faint">{message}</p>
    </div>
  );
}
