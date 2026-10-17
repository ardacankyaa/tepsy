const TABLE_EDGE_GAP = 28;
const TABLE_PADDING = 28;
const TABLE_GROWTH_STEP = 600;
const TABLE_CANVAS_MAX = 10000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const tableWidth = (table) => Number(table.width) || (table.shape === "RECTANGLE" ? 130 : 85);
const tableHeight = (table) => Number(table.height) || 85;

function scaleTablePosition(table, fromCanvas, toCanvas) {
  const width = tableWidth(table);
  const height = tableHeight(table);
  const maxX = Math.max(0, toCanvas.width - width);
  const maxY = Math.max(0, toCanvas.height - height);
  const worldX = ((Number(table.posX) || 0) * fromCanvas.width) / 100;
  const worldY = ((Number(table.posY) || 0) * fromCanvas.height) / 100;

  return {
    ...table,
    posX: (clamp(worldX, 0, maxX) / toCanvas.width) * 100,
    posY: (clamp(worldY, 0, maxY) / toCanvas.height) * 100,
  };
}

function scaleElementPosition(element, fromCanvas, toCanvas) {
  const width = Number(element.width) || 0;
  const height = Number(element.height) || 0;
  const worldX = ((Number(element.posX) || 0) * fromCanvas.width) / 100;
  const worldY = ((Number(element.posY) || 0) * fromCanvas.height) / 100;
  const maxX = Math.max(0, toCanvas.width - width);
  const maxY = Math.max(0, toCanvas.height - height);

  return {
    ...element,
    posX: (clamp(worldX, 0, maxX) / toCanvas.width) * 100,
    posY: (clamp(worldY, 0, maxY) / toCanvas.height) * 100,
  };
}

export function rescaleFloorPlanLayout({
  section,
  fromCanvas,
  toCanvas,
  tables = [],
  elements = [],
}) {
  return {
    tables: tables.map((table) =>
      table.section === section ? scaleTablePosition(table, fromCanvas, toCanvas) : table
    ),
    elements: elements.map((element) =>
      element.section === section ? scaleElementPosition(element, fromCanvas, toCanvas) : element
    ),
  };
}

function getOccupiedCells(tables, canvas, section, width, height, stepX, stepY) {
  const occupied = new Set();
  tables.forEach((table) => {
    if (table.section !== section) return;
    const x = ((Number(table.posX) || 0) * canvas.width) / 100;
    const y = ((Number(table.posY) || 0) * canvas.height) / 100;
    const right = x + tableWidth(table);
    const bottom = y + tableHeight(table);
    const minColumn = Math.max(0, Math.floor((x - width - TABLE_EDGE_GAP - TABLE_PADDING) / stepX));
    const maxColumn = Math.max(0, Math.ceil((right + TABLE_EDGE_GAP - TABLE_PADDING) / stepX));
    const minRow = Math.max(0, Math.floor((y - height - TABLE_EDGE_GAP - TABLE_PADDING) / stepY));
    const maxRow = Math.max(0, Math.ceil((bottom + TABLE_EDGE_GAP - TABLE_PADDING) / stepY));
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1)
        occupied.add(`${column}:${row}`);
    }
  });
  return occupied;
}

export function findFreeTablePosition({
  section,
  canvas,
  tables = [],
  width = 85,
  height = 85,
  maxCanvasSize = TABLE_CANVAS_MAX,
}) {
  const stepX = Math.max(180, width + TABLE_EDGE_GAP * 2 + 16);
  const stepY = Math.max(180, height + TABLE_EDGE_GAP * 2 + 16);
  const targetAspectRatio = canvas.width / canvas.height;
  let currentCanvas = { ...canvas };
  let currentTables = tables;

  while (true) {
    const occupied = getOccupiedCells(
      currentTables,
      currentCanvas,
      section,
      width,
      height,
      stepX,
      stepY
    );
    const lastColumn = Math.max(
      0,
      Math.floor((currentCanvas.width - width - TABLE_PADDING * 2) / stepX)
    );
    const lastRow = Math.max(
      0,
      Math.floor((currentCanvas.height - height - TABLE_PADDING * 2) / stepY)
    );
    for (let row = 0; row <= lastRow; row += 1) {
      for (let column = 0; column <= lastColumn; column += 1) {
        if (occupied.has(`${column}:${row}`)) continue;
        const x = TABLE_PADDING + column * stepX;
        const y = TABLE_PADDING + row * stepY;
        return {
          canvas: currentCanvas,
          position: {
            posX: (x / currentCanvas.width) * 100,
            posY: (y / currentCanvas.height) * 100,
          },
          tables: currentTables,
        };
      }
    }

    const canGrowWidth = currentCanvas.width < maxCanvasSize;
    const canGrowHeight = currentCanvas.height < maxCanvasSize;
    if (!canGrowWidth && !canGrowHeight) {
      return null;
    }
    const widerCanvas = canGrowWidth
      ? {
          ...currentCanvas,
          width: Math.min(maxCanvasSize, currentCanvas.width + TABLE_GROWTH_STEP),
        }
      : null;
    const deeperCanvas = canGrowHeight
      ? {
          ...currentCanvas,
          height: Math.min(maxCanvasSize, currentCanvas.height + TABLE_GROWTH_STEP),
        }
      : null;
    const widthAspectError = widerCanvas
      ? Math.abs(Math.log(widerCanvas.width / widerCanvas.height / targetAspectRatio))
      : Infinity;
    const heightAspectError = deeperCanvas
      ? Math.abs(Math.log(deeperCanvas.width / deeperCanvas.height / targetAspectRatio))
      : Infinity;
    const nextCanvas = widthAspectError <= heightAspectError ? widerCanvas : deeperCanvas;

    currentTables = rescaleFloorPlanLayout({
      section,
      fromCanvas: currentCanvas,
      toCanvas: nextCanvas,
      tables: currentTables,
      elements: [],
    }).tables;
    currentCanvas = nextCanvas;
  }
}
