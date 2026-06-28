import { useUploadQueue } from "../../hooks/upload/UploadQueueProvider";
import { QueueItemRow } from "./QueueItemRow";

export function UploadQueue() {
  const { items, removeItem, clearFinished } = useUploadQueue();

  if (items.length === 0) return null;

  const hasFinished = items.some((item) => item.status !== "processing");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Queue ({items.length})
        </h2>
        {hasFinished && (
          <button
            onClick={clearFinished}
            className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Clear finished
          </button>
        )}
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <QueueItemRow key={item.id} item={item} onRemove={removeItem} />
        ))}
      </div>
    </div>
  );
}
