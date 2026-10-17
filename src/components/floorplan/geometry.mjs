const DEFAULT_CANVAS = { width: 720, height: 450 };
const CANVAS_MIN_WIDTH = 720;
const CANVAS_MIN_HEIGHT = 450;
const CANVAS_MAX = 10000;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeFloorPlanCanvas(canvas) {
  return {
    width: clamp(
      Math.round(Number(canvas?.width) || DEFAULT_CANVAS.width),
      CANVAS_MIN_WIDTH,
      CANVAS_MAX
    ),
    height: clamp(
      Math.round(Number(canvas?.height) || DEFAULT_CANVAS.height),
      CANVAS_MIN_HEIGHT,
      CANVAS_MAX
    ),
  };
}

export function getFloorPlanFitZoom(viewportSize, canvas) {
  if (!viewportSize.width || !viewportSize.height) return 1;
  const gutter = 24;
  return clamp(
    Math.min(
      (viewportSize.width - gutter) / canvas.width,
      (viewportSize.height - gutter) / canvas.height
    ),
    0.05,
    2
  );
}

export function getTableDisplayDimensions(table, zoom) {
  const widthPx = (Number(table?.width) || (table?.shape === "RECTANGLE" ? 130 : 85)) * zoom;
  const heightPx = (Number(table?.height) || 85) * zoom;
  const chairCount = table?.shape === "RECTANGLE" || Number(table?.capacity) >= 6 ? 6 : 4;
  const chairSizePx = Math.max(5, 16 * zoom);
  const chairGapPx = Math.max(2, 6 * zoom);

  return {
    widthPx,
    heightPx,
    chairCount,
    chairSizePx,
    chairOffsetPx: chairSizePx + chairGapPx,
  };
}

export function clampFloorPlanPosition(value, containerSize, itemSize, outerInset = 0) {
  const itemPercent = containerSize > 0 ? (itemSize / containerSize) * 100 : 0;
  const insetPercent = containerSize > 0 ? (outerInset / containerSize) * 100 : 0;
  const marginPercent = Math.max(insetPercent, Math.min(2, Math.max(0, 100 - itemPercent)));
  const maxPercent = Math.max(marginPercent, 100 - itemPercent - insetPercent);
  return Math.max(marginPercent, Math.min(maxPercent, value));
}
