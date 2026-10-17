const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateCanvasSettings,
  validateTableDimensions,
  validateTableLayoutPayload,
  validateFloorElementsPayload,
  normalizeFloorElementDimensions,
} = require("../src/lib/floorplan-data.cjs");

test("canvas settings accept large logical dimensions and normalize section names", () => {
  assert.deepEqual(validateCanvasSettings({ section: "  Garden  ", width: 10000, height: 720 }), {
    value: { section: "Garden", width: 10000, height: 720 },
  });
  assert.deepEqual(validateCanvasSettings({ section: "Main Hall", width: 720, height: 450 }), {
    value: { section: "Main Hall", width: 720, height: 450 },
  });
});

test("canvas settings reject dimensions outside the supported range", () => {
  assert.equal(
    validateCanvasSettings({ section: "Garden", width: 719, height: 450 }).error,
    "invalid-canvas"
  );
  assert.equal(
    validateCanvasSettings({ section: "Garden", width: 720, height: 449 }).error,
    "invalid-canvas"
  );
  assert.equal(
    validateCanvasSettings({ section: "Garden", width: 720, height: 10001 }).error,
    "invalid-canvas"
  );
  assert.equal(
    validateCanvasSettings({ section: "Garden", width: 720.5, height: 900 }).error,
    "invalid-canvas"
  );
  assert.equal(
    validateCanvasSettings({ section: "  ", width: 900, height: 900 }).error,
    "invalid-section"
  );
});

test("table dimensions allow custom sizes up to 480 on both axes", () => {
  assert.deepEqual(validateTableDimensions({ width: 40, height: 480 }), {
    value: { width: 40, height: 480 },
  });
  assert.deepEqual(validateTableDimensions({ width: 480, height: 40 }), {
    value: { width: 480, height: 40 },
  });
});

test("table dimensions reject non-finite and out-of-range values", () => {
  assert.equal(
    validateTableDimensions({ width: 39, height: 85 }).error,
    "invalid-table-dimensions"
  );
  assert.equal(
    validateTableDimensions({ width: 85, height: 481 }).error,
    "invalid-table-dimensions"
  );
  assert.equal(
    validateTableDimensions({ width: "wide", height: 85 }).error,
    "invalid-table-dimensions"
  );
});

test("layout payloads support up to 1000 distinct table updates", () => {
  const tables = Array.from({ length: 1000 }, (_, index) => ({
    id: `table-${index}`,
    width: 480,
    height: 480,
  }));
  const result = validateTableLayoutPayload(tables);

  assert.equal(result.error, undefined);
  assert.equal(result.value.length, 1000);
  assert.deepEqual(result.value[999], { id: "table-999", width: 480, height: 480 });
});

test("layout payloads reject excessive, missing, duplicate, and invalid table updates", () => {
  const excessive = Array.from({ length: 1001 }, (_, index) => ({ id: `table-${index}` }));
  assert.equal(validateTableLayoutPayload(excessive).error, "too-many-tables");
  assert.equal(validateTableLayoutPayload([{ id: "" }]).error, "invalid-table-ids");
  assert.equal(
    validateTableLayoutPayload([{ id: "same" }, { id: "same" }]).error,
    "invalid-table-ids"
  );
  assert.equal(
    validateTableLayoutPayload([{ id: "table-1", width: 600 }]).error,
    "invalid-table-dimensions"
  );
});

test("floor element payloads support up to 1000 items per section", () => {
  const elements = Array.from({ length: 1000 }, (_, index) => ({ id: `floor-${index}` }));
  const result = validateFloorElementsPayload({ section: "Main Hall", elements });

  assert.equal(result.error, undefined);
  assert.equal(result.value.section, "Main Hall");
  assert.equal(result.value.elements.length, 1000);
  assert.equal(
    validateFloorElementsPayload({ section: "Main Hall", elements: [...elements, {}] }).error,
    "too-many-elements"
  );
});

test("floor element dimensions support geometry across a large venue", () => {
  assert.deepEqual(normalizeFloorElementDimensions({ width: 9500, height: 10000 }), {
    width: 9500,
    height: 10000,
  });
  assert.deepEqual(normalizeFloorElementDimensions({ width: 12000, height: -4 }), {
    width: 10000,
    height: 8,
  });
});
