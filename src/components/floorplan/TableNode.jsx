import { getTableNodeLayout, getTableStatusPresentation } from "./table-presentation.mjs";

export default function TableNode({
  table,
  zoom,
  isCompactCanvas,
  isEditable,
  selectedEditTableId,
  selectedTableId,
  translate,
  onPointerDown,
  onKeyDown,
}) {
  const isSelected = isEditable ? selectedEditTableId === table.id : selectedTableId === table.id;
  const status = getTableStatusPresentation(table.status, isSelected, translate);
  const layout = getTableNodeLayout(table, zoom, isCompactCanvas);
  const isSmall = layout.displayHeightPx < 64;
  const showCapacity = layout.displayHeightPx >= 80;
  const calls = table.serviceRequests || [];
  const callLabel = calls
    .map((call) => translate(call.type === "BILL" ? "billRequested" : "waiterCall"))
    .join(", ");

  return (
    <button
      type="button"
      onPointerDown={(event) => onPointerDown(event, table)}
      onKeyDown={(event) => onKeyDown(event, table)}
      aria-label={`${table.tableNumber}, ${table.section}, ${status.label}, ${table.capacity}P${calls.length ? `, ${callLabel}` : ""}`}
      title={`${table.tableNumber} · ${status.label}${calls.length ? ` · ${callLabel}` : ""}`}
      aria-pressed={isSelected}
      aria-describedby={layout.isMapOverview ? undefined : `table-status-${table.id}`}
      style={{
        ...layout.positionStyle,
        padding: layout.isMapOverview ? 0 : Math.min(10, layout.displayWidthPx * 0.1),
      }}
      className={`table-node absolute min-h-0 overflow-visible ${layout.isMapOverview ? "p-0" : isCompactCanvas ? "p-1.5" : "p-2.5"} flex flex-col justify-between text-left transition-colors select-none ${isEditable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${layout.shapeClass} ${status.surfaceClass} ${status.isSelected ? "table-node-selected" : ""}`}
    >
      {layout.chairPositions.map((position, chairIndex) => (
        <span
          key={`${table.id}-chair-${chairIndex}`}
          aria-hidden="true"
          className="table-chair pointer-events-none absolute z-0 rounded-[4px] border"
          style={{
            ...position,
            width: `${layout.chairSizePx}px`,
            height: `${layout.chairSizePx}px`,
            backgroundColor: status.chairBackground,
            borderColor: status.chairBorder,
          }}
        />
      ))}

      {calls.length > 0 && (
        <span className="table-call-badge" aria-hidden="true">
          !
        </span>
      )}
      {!layout.isMapOverview && (
        <div
          className={`table-node-content ${table.shape === "ROUND" ? "is-round" : ""} ${table.shape !== "RECTANGLE" ? "is-centered" : ""} ${isSmall ? "is-small" : ""}`}
        >
          <div className="table-node-heading">
            <span
              className={`table-node-name font-black tracking-tight truncate ${isCompactCanvas ? "text-[10px]" : "text-xs"}`}
            >
              {layout.compactTableNumber}
            </span>
            {showCapacity && (
              <span
                className={`table-node-capacity ${isCompactCanvas ? "text-[8px]" : "text-[10px]"} font-semibold text-current opacity-90`}
              >
                {table.capacity}P
              </span>
            )}
          </div>

          <div
            id={`table-status-${table.id}`}
            className={isSmall ? "sr-only" : "relative z-10 text-center"}
          >
            <span className="table-node-status text-[10px] font-semibold text-current opacity-95">
              <span className={`w-2 h-2 shrink-0 rounded-full inline-block ${status.dot}`} />
              <span className="truncate">{status.label}</span>
            </span>
          </div>
        </div>
      )}
    </button>
  );
}
