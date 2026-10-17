const MIN_CANVAS_WIDTH = 720;
const MIN_CANVAS_HEIGHT = 450;
const MAX_CANVAS_DIMENSION = 10000;
const DEFAULT_CANVAS_WIDTH = 720;
const DEFAULT_CANVAS_HEIGHT = 450;
const MIN_TABLE_DIMENSION = 40;
const MAX_TABLE_DIMENSION = 480;
const MAX_TABLE_LAYOUT_ROWS = 1000;
const MAX_FLOOR_ELEMENTS = 1000;
const MAX_FLOOR_ELEMENT_DIMENSION = 10000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateCanvasSettings(input) {
  if (!isRecord(input)) return { error: "invalid-section" };
  const section = String(input.section ?? "").trim();
  if (!section || section.length > 80) return { error: "invalid-section" };

  const { width, height } = input;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < MIN_CANVAS_WIDTH ||
    width > MAX_CANVAS_DIMENSION ||
    height < MIN_CANVAS_HEIGHT ||
    height > MAX_CANVAS_DIMENSION
  ) {
    return { error: "invalid-canvas" };
  }

  return { value: { section, width, height } };
}

function validateTableDimensions(input) {
  if (!isRecord(input)) return { error: "invalid-table-dimensions" };
  const value = {};

  for (const field of ["width", "height"]) {
    if (input[field] === undefined) continue;
    const dimension = Number(input[field]);
    if (
      !Number.isFinite(dimension) ||
      dimension < MIN_TABLE_DIMENSION ||
      dimension > MAX_TABLE_DIMENSION
    ) {
      return { error: "invalid-table-dimensions" };
    }
    value[field] = Math.round(dimension);
  }

  return { value };
}

function validateTableLayoutPayload(tables) {
  if (!Array.isArray(tables)) return { error: "invalid-table-list" };
  if (tables.length > MAX_TABLE_LAYOUT_ROWS) return { error: "too-many-tables" };

  const ids = new Set();
  const value = [];

  for (const table of tables) {
    if (!isRecord(table)) return { error: "invalid-table-ids" };
    const id = String(table.id ?? "").trim();
    if (!id || id.length > 100 || ids.has(id)) return { error: "invalid-table-ids" };
    ids.add(id);

    const dimensions = validateTableDimensions(table);
    if (dimensions.error) return dimensions;
    value.push({ ...table, id, ...dimensions.value });
  }

  return { value };
}

function validateFloorElementsPayload(input) {
  if (!isRecord(input)) return { error: "invalid-element-list" };
  const section = String(input.section ?? "").trim();
  if (!section || section.length > 80) return { error: "invalid-section" };
  if (!Array.isArray(input.elements)) return { error: "invalid-element-list" };
  if (input.elements.length > MAX_FLOOR_ELEMENTS) return { error: "too-many-elements" };
  if (input.elements.some((element) => !isRecord(element))) return { error: "invalid-elements" };
  return { value: { section, elements: input.elements } };
}

function normalizeFloorElementDimensions(input) {
  const source = isRecord(input) ? input : {};
  return {
    width: Math.max(
      8,
      Math.min(MAX_FLOOR_ELEMENT_DIMENSION, Math.round(Number(source.width) || 96))
    ),
    height: Math.max(
      8,
      Math.min(MAX_FLOOR_ELEMENT_DIMENSION, Math.round(Number(source.height) || 48))
    ),
  };
}

module.exports = {
  MIN_CANVAS_WIDTH,
  MIN_CANVAS_HEIGHT,
  MAX_CANVAS_DIMENSION,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_CANVAS_HEIGHT,
  MIN_TABLE_DIMENSION,
  MAX_TABLE_DIMENSION,
  MAX_TABLE_LAYOUT_ROWS,
  MAX_FLOOR_ELEMENTS,
  MAX_FLOOR_ELEMENT_DIMENSION,
  validateCanvasSettings,
  validateTableDimensions,
  validateTableLayoutPayload,
  validateFloorElementsPayload,
  normalizeFloorElementDimensions,
};
