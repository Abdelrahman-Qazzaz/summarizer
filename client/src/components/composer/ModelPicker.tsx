import { useMemo, useState } from "react";
import type { ModelInfo } from "../../api/models";
import { Icon } from "../ui/Icon";
import { useDismissable } from "../ui/useDismissable";

export type ModelOption = {
  id: string;
  label: string;
  info: ModelInfo;
};

type ModelPickerProps = {
  models: ModelOption[];
  value: string | null;
  onChange: (modelId: string) => void;
  /** True while an image is staged: the list is down to vision models. */
  visionOnly: boolean;
  loading: boolean;
  error: string | null;
};

export function ModelPicker({
  models,
  value,
  onChange,
  visionOnly,
  loading,
  error,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const menuRef = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return models;
    return models.filter(
      (model) =>
        model.id.toLowerCase().includes(query) ||
        model.label.toLowerCase().includes(query),
    );
  }, [models, search]);

  const selected = models.find((model) => model.id === value);

  if (error) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-live">
        <Icon name="alert" className="h-3.5 w-3.5" />
        {error}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={loading}
        aria-label="Choose the chat model"
        aria-expanded={open}
        className="flex max-w-[13rem] items-center gap-1 rounded-lg px-2 py-1.5 font-mono text-[11px] text-muted transition-colors hover:bg-sunk hover:text-ink disabled:opacity-40"
      >
        <span className="truncate">
          {loading ? "loading models…" : (selected?.id ?? "no model")}
        </span>
        <Icon name="chevronDown" className="h-3.5 w-3.5 shrink-0" />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute bottom-10 left-0 z-30 flex max-h-80 w-80 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
        >
          <div className="border-b border-line p-2">
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models"
              aria-label="Search models"
              className="w-full rounded-lg bg-canvas px-2.5 py-2 text-sm outline-none placeholder:text-faint"
            />
          </div>

          {visionOnly && (
            <p className="border-b border-line px-3 py-2 text-[11px] text-muted">
              Showing models that read images.
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {matches.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-faint">
                No model matches that.
              </p>
            ) : (
              matches.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onChange(model.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-sunk"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {model.label}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-faint">
                      {model.id}
                    </span>
                  </span>
                  {model.id === value && (
                    <Icon name="check" className="h-4 w-4 text-signal" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
