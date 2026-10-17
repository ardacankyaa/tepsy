import { getTableDisplayDimensions } from "./geometry.mjs";

export const TABLE_SIZE_MIN = 40;
export const TABLE_SIZE_MAX = 480;

const TABLE_STATUS_PRESENTATION = {
  BILL_REQUESTED: {
    translationKey: "billRequested",
    dot: "bg-[var(--warning)]",
    surfaceClass: "table-state-bill z-20",
    chairBackground: "#e7d6a8",
    chairBorder: "#b18a37",
  },
  OCCUPIED: {
    translationKey: "occupied",
    dot: "bg-[var(--danger)]",
    surfaceClass: "table-state-occupied z-10",
    chairBackground: "#e4c5c3",
    chairBorder: "#c18785",
  },
  AVAILABLE: {
    translationKey: "available",
    dot: "bg-[var(--success)]",
    surfaceClass: "table-state-available",
    chairBackground: "#bfd2c2",
    chairBorder: "#82a489",
  },
};

export function getTableStatusPresentation(status, isSelected, translate) {
  const statusPresentation =
    TABLE_STATUS_PRESENTATION[status] || TABLE_STATUS_PRESENTATION.AVAILABLE;
  const presentation = {
    label: translate(statusPresentation.translationKey),
    dot: statusPresentation.dot,
    surfaceClass: statusPresentation.surfaceClass,
    chairBackground: statusPresentation.chairBackground,
    chairBorder: statusPresentation.chairBorder,
  };

  return isSelected
    ? { ...presentation, chairBackground: "#D7E8FC", chairBorder: "#0066CC", isSelected: true }
    : presentation;
}

export function getTableNodeLayout(table, zoom, isCompactCanvas) {
  const { widthPx, heightPx, chairCount, chairSizePx, chairOffsetPx } = getTableDisplayDimensions(
    table,
    zoom
  );
  const isMapOverview = zoom < 0.28;
  const displayWidthPx = isMapOverview ? Math.max(18, widthPx) : widthPx;
  const displayHeightPx = isMapOverview ? Math.max(18, heightPx) : heightPx;
  const chairCenterX = `calc(50% - ${chairSizePx / 2}px)`;
  const chairCenterY = `calc(50% - ${chairSizePx / 2}px)`;
  const chairPositions = isMapOverview
    ? []
    : chairCount === 6
      ? [
          { top: `${-chairOffsetPx}px`, left: `calc(25% - ${chairSizePx / 2}px)` },
          { top: `${-chairOffsetPx}px`, left: `calc(75% - ${chairSizePx / 2}px)` },
          { bottom: `${-chairOffsetPx}px`, left: `calc(25% - ${chairSizePx / 2}px)` },
          { bottom: `${-chairOffsetPx}px`, left: `calc(75% - ${chairSizePx / 2}px)` },
          { left: `${-chairOffsetPx}px`, top: chairCenterY },
          { right: `${-chairOffsetPx}px`, top: chairCenterY },
        ]
      : [
          { top: `${-chairOffsetPx}px`, left: chairCenterX },
          { bottom: `${-chairOffsetPx}px`, left: chairCenterX },
          { left: `${-chairOffsetPx}px`, top: chairCenterY },
          { right: `${-chairOffsetPx}px`, top: chairCenterY },
        ];

  return {
    compactTableNumber: isCompactCanvas
      ? String(table.tableNumber || "").replace(/^(masa|table)\s*/i, "")
      : table.tableNumber,
    isMapOverview,
    displayWidthPx,
    displayHeightPx,
    chairCount,
    chairSizePx,
    chairOffsetPx,
    chairPositions,
    shapeClass: table.shape === "ROUND" ? "rounded-full aspect-square" : "rounded-xl",
    positionStyle: {
      left: `clamp(${isMapOverview ? 0 : chairOffsetPx}px, ${table.posX}%, calc(100% - ${displayWidthPx + (isMapOverview ? 0 : chairOffsetPx)}px))`,
      top: `clamp(${isMapOverview ? 0 : chairOffsetPx}px, ${table.posY}%, calc(100% - ${displayHeightPx + (isMapOverview ? 0 : chairOffsetPx)}px))`,
      width: `${displayWidthPx}px`,
      height: `${displayHeightPx}px`,
    },
  };
}

export function getTableSizePresetDimensions(table, sizeType) {
  if (sizeType === "SMALL") return { width: 70, height: 70 };
  if (sizeType === "LARGE") {
    return table.shape === "RECTANGLE" ? { width: 220, height: 100 } : { width: 120, height: 120 };
  }
  if (sizeType === "BANQUET") return { width: 360, height: 100 };
  if (table.shape === "RECTANGLE") return { width: 150, height: 90 };
  return { width: 90, height: 90 };
}
