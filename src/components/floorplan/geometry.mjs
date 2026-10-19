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

export function getRotatedFloorElementBounds(widthPx, heightPx, rotation = 0) {
  const width = Math.max(0, Number(widthPx) || 0);
  const height = Math.max(0, Number(heightPx) || 0);
  const angle = Number(rotation);
  const normalizedAngle = Number.isFinite(angle) ? ((Math.round(angle) % 360) + 360) % 360 : 0;
  const radians = (normalizedAngle * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const stableCosine = cosine < 1e-10 ? 0 : cosine;
  const stableSine = sine < 1e-10 ? 0 : sine;
  const rotatedWidthPx = width * stableCosine + height * stableSine;
  const rotatedHeightPx = width * stableSine + height * stableCosine;

  return {
    widthPx: rotatedWidthPx,
    heightPx: rotatedHeightPx,
    offsetX: (width - rotatedWidthPx) / 2,
    offsetY: (height - rotatedHeightPx) / 2,
  };
}

export function clampRotatedFloorPlanPosition(value, containerSize, elementSize, rotatedSize) {
  if (!(containerSize > 0)) return value;
  const rotatedPercent = (rotatedSize / containerSize) * 100;
  const anchorOffsetPercent = ((elementSize - rotatedSize) / (2 * containerSize)) * 100;
  const minPercent = Math.max(0, -anchorOffsetPercent);
  const maxPercent = Math.max(minPercent, 100 - rotatedPercent - anchorOffsetPercent);
  return clamp(value, minPercent, maxPercent);
}
