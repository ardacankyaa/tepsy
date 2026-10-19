import assert from "node:assert/strict";
import test from "node:test";

import {
  clampRotatedFloorPlanPosition,
  getRotatedFloorElementBounds,
} from "../components/floorplan/geometry.mjs";
import * as tablePresentation from "../components/floorplan/table-presentation.mjs";

test("rotated floor element bounds include its visual footprint around the CSS anchor", () => {
  assert.deepEqual(getRotatedFloorElementBounds(180, 14, 90), {
    widthPx: 14,
    heightPx: 180,
    offsetX: 83,
    offsetY: -83,
  });

  const diagonalWall = getRotatedFloorElementBounds(180, 14, 15);
  assert.ok(diagonalWall.heightPx > 14);
  assert.ok(diagonalWall.offsetY < 0);
  assert.deepEqual(getRotatedFloorElementBounds(180, 14, 450), {
    widthPx: 14,
    heightPx: 180,
    offsetX: 83,
    offsetY: -83,
  });
});

test("rotated element positions clamp the transformed bounds without shifting the grab anchor", () => {
  const verticalWall = getRotatedFloorElementBounds(180, 14, 90);
  const leftPosition = clampRotatedFloorPlanPosition(0, 720, 180, verticalWall.widthPx);
  const rightPosition = clampRotatedFloorPlanPosition(100, 720, 180, verticalWall.widthPx);
  const topPosition = clampRotatedFloorPlanPosition(0, 450, 14, verticalWall.heightPx);
  const bottomPosition = clampRotatedFloorPlanPosition(100, 450, 14, verticalWall.heightPx);

  assert.equal(leftPosition, 0);
  assert.ok(Math.abs(rightPosition - ((720 - 14 - 83) / 720) * 100) < 1e-9);
  assert.ok(Math.abs(topPosition - (83 / 450) * 100) < 1e-9);
  assert.ok(Math.abs(bottomPosition - ((450 - 180 + 83) / 450) * 100) < 1e-9);

  const topVisualEdge = (topPosition * 450) / 100 + verticalWall.offsetY;
  const bottomVisualEdge =
    (bottomPosition * 450) / 100 + verticalWall.offsetY + verticalWall.heightPx;
  assert.ok(Math.abs(topVisualEdge) < 1e-9);
  assert.ok(Math.abs(bottomVisualEdge - 450) < 1e-9);
});

test("table status presentation keeps service state and selection styling aligned", () => {
  assert.equal(typeof tablePresentation.getTableStatusPresentation, "function");

  const translate = (key) =>
    ({
      billRequested: "Bill requested",
      occupied: "Occupied",
      available: "Available",
    })[key];

  assert.deepEqual(
    tablePresentation.getTableStatusPresentation("BILL_REQUESTED", true, translate),
    {
      label: "Bill requested",
      dot: "bg-[var(--warning)]",
      surfaceClass: "table-state-bill z-20",
      chairBackground: "#D7E8FC",
      chairBorder: "#0066CC",
      isSelected: true,
    }
  );
  assert.deepEqual(tablePresentation.getTableStatusPresentation("OCCUPIED", false, translate), {
    label: "Occupied",
    dot: "bg-[var(--danger)]",
    surfaceClass: "table-state-occupied z-10",
    chairBackground: "#e4c5c3",
    chairBorder: "#c18785",
  });
  assert.deepEqual(tablePresentation.getTableStatusPresentation("UNKNOWN", false, translate), {
    label: "Available",
    dot: "bg-[var(--success)]",
    surfaceClass: "table-state-available",
    chairBackground: "#bfd2c2",
    chairBorder: "#82a489",
  });
});

test("table node layout preserves compact labels and overview sizing rules", () => {
  assert.equal(typeof tablePresentation.getTableNodeLayout, "function");

  assert.deepEqual(
    tablePresentation.getTableNodeLayout(
      {
        tableNumber: "Masa 12",
        posX: 25,
        posY: 40,
        shape: "ROUND",
        capacity: 4,
        width: 85,
        height: 85,
      },
      0.2,
      true
    ),
    {
      compactTableNumber: "12",
      isMapOverview: true,
      displayWidthPx: 18,
      displayHeightPx: 18,
      chairCount: 4,
      chairSizePx: 5,
      chairOffsetPx: 7,
      chairPositions: [],
      shapeClass: "rounded-full aspect-square",
      positionStyle: {
        left: "clamp(0px, 25%, calc(100% - 18px))",
        top: "clamp(0px, 40%, calc(100% - 18px))",
        width: "18px",
        height: "18px",
      },
    }
  );
});
test("table size presets preserve shape-specific dimensions", () => {
  assert.equal(typeof tablePresentation.getTableSizePresetDimensions, "function");
  assert.deepEqual(tablePresentation.getTableSizePresetDimensions({ shape: "SQUARE" }, "SMALL"), {
    width: 70,
    height: 70,
  });
  assert.deepEqual(
    tablePresentation.getTableSizePresetDimensions({ shape: "RECTANGLE" }, "MEDIUM"),
    { width: 150, height: 90 }
  );
  assert.deepEqual(tablePresentation.getTableSizePresetDimensions({ shape: "ROUND" }, "LARGE"), {
    width: 120,
    height: 120,
  });
  assert.deepEqual(
    tablePresentation.getTableSizePresetDimensions({ shape: "RECTANGLE" }, "LARGE"),
    { width: 220, height: 100 }
  );
  assert.deepEqual(tablePresentation.getTableSizePresetDimensions({ shape: "SQUARE" }, "BANQUET"), {
    width: 360,
    height: 100,
  });
});
