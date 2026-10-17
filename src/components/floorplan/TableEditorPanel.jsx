import { Circle, Plus, RectangleHorizontal, Square, Trash2, X } from "lucide-react";
import { TABLE_SIZE_MAX, TABLE_SIZE_MIN } from "./table-presentation.mjs";

export default function TableEditorPanel({
  table,
  lang,
  translate,
  isAddingTable,
  canDuplicate,
  getSizeDraft,
  onNameChange,
  onShapeChange,
  onSizePreset,
  onSizeDraftChange,
  onSizeCommit,
  onCapacityChange,
  onDuplicate,
  onDelete,
  onClose,
}) {
  return (
    <div className="floor-table-properties surface-panel mt-2 flex flex-wrap items-center justify-between gap-3 p-3 text-xs animate-in slide-in-from-bottom-2">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[var(--text-primary)]">
          {translate("tableNameOrNumber")}:
        </span>
        <input
          type="text"
          value={table.tableNumber}
          onChange={(event) => onNameChange(event.target.value)}
          aria-label={translate("tableNameOrNumber")}
          className="min-h-11 w-28 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-2.5 text-xs font-semibold text-[var(--text-primary)]"
        />
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-1">
        <button
          type="button"
          onClick={() => onShapeChange("SQUARE")}
          aria-pressed={table.shape === "SQUARE"}
          className={`min-h-11 px-2.5 rounded text-[11px] font-bold flex items-center gap-1 ${
            table.shape === "SQUARE"
              ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Square className="w-3 h-3" />
          <span>{translate("square")}</span>
        </button>
        <button
          type="button"
          onClick={() => onShapeChange("ROUND")}
          aria-pressed={table.shape === "ROUND"}
          className={`min-h-11 px-2.5 rounded text-[11px] font-bold flex items-center gap-1 ${
            table.shape === "ROUND"
              ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Circle className="w-3 h-3" />
          <span>{translate("round")}</span>
        </button>
        <button
          type="button"
          onClick={() => onShapeChange("RECTANGLE")}
          aria-pressed={table.shape === "RECTANGLE"}
          className={`min-h-11 px-2.5 rounded text-[11px] font-bold flex items-center gap-1 ${
            table.shape === "RECTANGLE"
              ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <RectangleHorizontal className="w-3 h-3" />
          <span>{translate("rectangle")}</span>
        </button>
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-1">
        <span className="px-1 text-[11px] font-semibold text-[var(--text-muted)]">
          {translate("size")}:
        </span>
        <button
          type="button"
          onClick={() => onSizePreset("SMALL")}
          className="secondary-action min-h-11 px-2 text-xs font-medium"
        >
          {lang === "tr" ? "Küçük" : "Small"}
        </button>
        <button
          type="button"
          onClick={() => onSizePreset("MEDIUM")}
          className="secondary-action min-h-11 px-2 text-xs font-medium"
        >
          {lang === "tr" ? "Standart" : "Standard"}
        </button>
        <button
          type="button"
          onClick={() => onSizePreset("LARGE")}
          className="secondary-action min-h-11 px-2 text-xs font-medium"
        >
          {lang === "tr" ? "Geniş" : "Wide"}
        </button>
        {table.shape === "RECTANGLE" && (
          <button
            type="button"
            onClick={() => onSizePreset("BANQUET")}
            className="secondary-action min-h-11 px-2 text-xs font-medium"
          >
            {lang === "tr" ? "Banket" : "Banquet"}
          </button>
        )}
      </div>

      <div className="floorplan-table-dimensions flex items-center gap-2">
        <label className="floorplan-size-field font-semibold text-[var(--text-muted)]">
          {table.shape === "ROUND"
            ? lang === "tr"
              ? "Çap"
              : "Diameter"
            : table.shape === "SQUARE"
              ? lang === "tr"
                ? "Boyut"
                : "Size"
              : lang === "tr"
                ? "Genişlik"
                : "Width"}
          <input
            type="number"
            min={TABLE_SIZE_MIN}
            max={TABLE_SIZE_MAX}
            step={5}
            value={getSizeDraft("width")}
            onChange={(event) => onSizeDraftChange("width", event.target.value)}
            onBlur={() => onSizeCommit("width")}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            aria-label={
              table.shape === "ROUND"
                ? lang === "tr"
                  ? "Masa çapı"
                  : "Table diameter"
                : table.shape === "SQUARE"
                  ? lang === "tr"
                    ? "Masa boyutu"
                    : "Table size"
                  : lang === "tr"
                    ? "Masa genişliği"
                    : "Table width"
            }
            className="min-h-11 w-20 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-2 text-xs font-semibold tabular-nums text-[var(--text-primary)]"
          />
        </label>
        {table.shape === "RECTANGLE" && (
          <label className="floorplan-size-field font-semibold text-[var(--text-muted)]">
            {lang === "tr" ? "Derinlik" : "Depth"}
            <input
              type="number"
              min={TABLE_SIZE_MIN}
              max={TABLE_SIZE_MAX}
              step={5}
              value={getSizeDraft("height")}
              onChange={(event) => onSizeDraftChange("height", event.target.value)}
              onBlur={() => onSizeCommit("height")}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              aria-label={lang === "tr" ? "Masa derinliği" : "Table depth"}
              className="min-h-11 w-20 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-2 text-xs font-semibold tabular-nums text-[var(--text-primary)]"
            />
          </label>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-[var(--text-primary)]">{translate("capacity")}:</span>
        <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-2 py-0.5">
          <button
            type="button"
            onClick={() => onCapacityChange(-1)}
            aria-label={lang === "tr" ? "Kapasite azalt" : "Decrease capacity"}
            className="secondary-action flex min-h-11 min-w-11 items-center justify-center font-semibold"
          >
            -
          </button>
          <span className="px-1.5 font-semibold text-[var(--text-primary)]">{table.capacity}P</span>
          <button
            type="button"
            onClick={() => onCapacityChange(1)}
            aria-label={lang === "tr" ? "Kapasite artır" : "Increase capacity"}
            className="secondary-action flex min-h-11 min-w-11 items-center justify-center font-semibold"
          >
            +
          </button>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {canDuplicate && (
          <button
            type="button"
            onClick={onDuplicate}
            disabled={isAddingTable}
            className="secondary-action min-h-11 flex items-center gap-1.5 px-2.5 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{lang === "tr" ? "Kopyala" : "Duplicate"}</span>
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(table)}
            className="min-h-11 flex items-center gap-1.5 rounded-lg border border-[var(--danger-border)] px-2.5 text-[var(--danger)] hover:bg-[var(--danger-surface)]"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{translate("delete")}</span>
          </button>
        )}
        <button
          type="button"
          aria-label={translate("close")}
          onClick={onClose}
          className="secondary-action min-h-11 min-w-11 p-1"
        >
          <X className="w-4 h-4 mx-auto" />
        </button>
      </div>
    </div>
  );
}
