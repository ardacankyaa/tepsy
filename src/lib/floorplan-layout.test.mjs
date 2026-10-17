import assert from "node:assert/strict";
import test from "node:test";
import * as floorPlanLayout from "./floorplan-layout.mjs";
import * as floorPlanGeometry from "../components/floorplan/geometry.mjs";

test("canvas expansion preserves table and architecture world coordinates", () => {
  assert.equal(typeof floorPlanLayout.rescaleFloorPlanLayout, "function");

  const result = floorPlanLayout.rescaleFloorPlanLayout({
    section: "Bahçe",
    fromCanvas: { width: 720, height: 450 },
    toCanvas: { width: 1440, height: 900 },
    tables: [
      { id: "table-a", section: "Bahçe", posX: 50, posY: 50, width: 90, height: 90 },
      { id: "table-edge", section: "Bahçe", posX: 1, posY: 2, width: 90, height: 90 },
      { id: "table-b", section: "Teras", posX: 50, posY: 50, width: 90, height: 90 },
    ],
    elements: [{ id: "wall-a", section: "Bahçe", posX: 50, posY: 40, width: 360, height: 12 }],
  });

  assert.equal(result.tables[0].posX, 25);
  assert.equal(result.tables[0].posY, 25);
  assert.equal((result.tables[1].posX * 1440) / 100, (1 * 720) / 100);
  assert.equal((result.tables[1].posY * 900) / 100, (2 * 450) / 100);
  assert.equal(result.elements[0].posX, 25);
  assert.equal(result.elements[0].posY, 20);
  assert.equal((result.tables[0].posX * 1440) / 100, (50 * 720) / 100);
  assert.equal((result.elements[0].posY * 900) / 100, (40 * 450) / 100);
  assert.deepEqual(result.tables[2], {
    id: "table-b",
    section: "Teras",
    posX: 50,
    posY: 50,
    width: 90,
    height: 90,
  });
});

test("new table placement leaves clearance from existing tables", () => {
  assert.equal(typeof floorPlanLayout.findFreeTablePosition, "function");

  const result = floorPlanLayout.findFreeTablePosition({
    section: "Bahçe",
    canvas: { width: 720, height: 450 },
    tables: [
      {
        id: "table-a",
        section: "Bahçe",
        posX: (28 / 720) * 100,
        posY: (28 / 450) * 100,
        width: 90,
        height: 90,
      },
    ],
    width: 90,
    height: 90,
  });

  assert.ok(result);
  const x = (result.position.posX * result.canvas.width) / 100;
  const y = (result.position.posY * result.canvas.height) / 100;
  assert.ok(x >= 28 + 90 + 28 || y >= 28 + 90 + 28);
});

test("canvas normalization applies defaults, rounding, and size limits", () => {
  assert.equal(typeof floorPlanGeometry.normalizeFloorPlanCanvas, "function");
  assert.deepEqual(floorPlanGeometry.normalizeFloorPlanCanvas(), { width: 720, height: 450 });
  assert.deepEqual(floorPlanGeometry.normalizeFloorPlanCanvas({ width: 719.6, height: 10001 }), {
    width: 720,
    height: 10000,
  });
});

test("fit zoom uses the smaller viewport ratio and returns a safe default before measurement", () => {
  assert.equal(typeof floorPlanGeometry.getFloorPlanFitZoom, "function");
  assert.equal(
    floorPlanGeometry.getFloorPlanFitZoom({ width: 0, height: 300 }, { width: 720, height: 450 }),
    1
  );
  assert.equal(
    floorPlanGeometry.getFloorPlanFitZoom(
      { width: 1024, height: 768 },
      { width: 720, height: 450 }
    ),
    1000 / 720
  );
});

test("table display dimensions preserve the shape and capacity chair rules", () => {
  assert.equal(typeof floorPlanGeometry.getTableDisplayDimensions, "function");
  assert.deepEqual(
    floorPlanGeometry.getTableDisplayDimensions({ shape: "RECTANGLE", capacity: 4 }, 0.5),
    {
      widthPx: 65,
      heightPx: 42.5,
      chairCount: 6,
      chairSizePx: 8,
      chairOffsetPx: 11,
    }
  );
  assert.equal(
    floorPlanGeometry.getTableDisplayDimensions({ shape: "SQUARE", capacity: 6 }, 0.1).chairCount,
    6
  );
});

test("position clamping reserves table size and the requested outer inset", () => {
  assert.equal(typeof floorPlanGeometry.clampFloorPlanPosition, "function");
  assert.equal(floorPlanGeometry.clampFloorPlanPosition(99, 100, 30, 10), 60);
  assert.equal(floorPlanGeometry.clampFloorPlanPosition(-20, 100, 30, 10), 10);
});
