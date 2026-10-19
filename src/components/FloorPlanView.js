"use client";

import { useCallback, useEffect, useLayoutEffect, useState, useRef } from "react";
import { useSocket } from "@/lib/socket-client";
import { useApp } from "@/lib/AppContext";
import {
  Save,
  RotateCcw,
  RotateCw,
  Layers,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Plus,
  X,
} from "lucide-react";
import FloorElement, {
  FLOOR_ELEMENT_DEFAULTS,
  FLOOR_ELEMENT_TYPES,
  getFloorElementLabel,
  normalizeFloorElementRotation,
} from "@/components/floorplan/FloorElement";
import TableNode from "@/components/floorplan/TableNode";
import TableEditorPanel from "@/components/floorplan/TableEditorPanel";
import {
  clamp,
  clampFloorPlanPosition as clampTablePosition,
  clampRotatedFloorPlanPosition,
  getFloorPlanFitZoom,
  getRotatedFloorElementBounds,
  getTableDisplayDimensions,
  normalizeFloorPlanCanvas as normalizeCanvas,
} from "@/components/floorplan/geometry.mjs";
import {
  findFreeTablePosition as locateFreeTablePosition,
  rescaleFloorPlanLayout,
} from "@/lib/floorplan-layout.mjs";
import {
  getTableSizePresetDimensions,
  TABLE_SIZE_MAX,
  TABLE_SIZE_MIN,
} from "@/components/floorplan/table-presentation.mjs";

const CANVAS_MIN_WIDTH = 720;
const CANVAS_MIN_HEIGHT = 450;
const CANVAS_MAX = 10000;
const FLOOR_ELEMENT_WIDTH_MAX = 10000;
const FLOOR_ELEMENT_HEIGHT_MAX = 10000;

const CANVAS_PRESETS = [
  { id: "compact", width: 720, height: 450, tr: "Kompakt", en: "Compact" },
  { id: "dining", width: 1440, height: 900, tr: "Yemek salonu", en: "Dining room" },
  { id: "large", width: 2400, height: 1500, tr: "Geniş salon", en: "Large venue" },
];

export default function FloorPlanView({
  tables = [],
  section = "ALL",
  canvas,
  isEditable = false,
  selectedTableId = null,
  onSelectTable,
  onSaveLayout,
  onDeleteTable,
  showModeBar = true,
  elements = [],
  onElementsChange,
  onDeleteElement,
  onAddElement,
  onAddTable,
  showElementTools = false,
  onDirtyChange,
}) {
  const { socket } = useSocket();
  const { t, lang } = useApp();
  const [localTables, setLocalTables] = useState(Array.isArray(tables) ? tables : []);
  const [activeDragId, setActiveDragId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [activePointerId, setActivePointerId] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [isAddingTable, setIsAddingTable] = useState(false);
  const [selectedEditTable, setSelectedEditTable] = useState(null);
  const [tableSizeDrafts, setTableSizeDrafts] = useState({});
  const [localElements, setLocalElements] = useState(Array.isArray(elements) ? elements : []);
  const localElementsRef = useRef(localElements);
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [elementSizeDrafts, setElementSizeDrafts] = useState({});
  const [activeElementDragId, setActiveElementDragId] = useState(null);
  const [activePan, setActivePan] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const [elementDragOffset, setElementDragOffset] = useState({ x: 0, y: 0 });
  const [localCanvas, setLocalCanvas] = useState(() => normalizeCanvas(canvas));
  const [canvasFields, setCanvasFields] = useState(() => {
    const initialCanvas = normalizeCanvas(canvas);
    return { width: String(initialCanvas.width), height: String(initialCanvas.height) };
  });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef(null);
  const rootRef = useRef(null);
  const containerRef = useRef(null);
  const activePointerTargetRef = useRef(null);
  const hasChangesRef = useRef(false);
  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);
  useEffect(() => {
    if (!isEditable || !hasChanges) return;
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const beforeNavigation = (event) => {
      const link = event.target.closest?.("a[href]");
      if (
        !link ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (link.href === window.location.href || link.getAttribute("href").startsWith("#")) return;
      if (
        !window.confirm(
          lang === "tr"
            ? "Kaydedilmemiş kroki değişiklikleri var. Kaydetmeden çıkılsın mı?"
            : "There are unsaved floor-plan changes. Leave without saving?"
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeNavigation, true);
    };
  }, [isEditable, hasChanges, lang]);
  const dirtyFieldsRef = useRef(new Map());
  const panStartRef = useRef(null);
  const zoomAnchorRef = useRef(null);
  const zoomedForLayoutRef = useRef(null);

  useEffect(() => {
    const handleFullscreenChange = () =>
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      setFullscreenError("");
      if (document.fullscreenElement === rootRef.current) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      const message =
        lang === "tr"
          ? "Tam ekran açılamadı. Tarayıcı izinlerini kontrol edin."
          : "Full screen could not open. Check browser permissions.";
      if (isEditable) setSaveError(message);
      else setFullscreenError(message);
    }
  };

  useEffect(() => {
    const nextTables = Array.isArray(tables) ? tables : [];

    // A live status/order refresh must not discard an in-progress layout edit.
    // Merge remote fields while preserving only the fields changed locally.
    if (!hasChangesRef.current) {
      setLocalTables(nextTables);
      return;
    }

    setLocalTables((currentTables) => {
      const currentById = new Map(currentTables.map((table) => [table.id, table]));
      return nextTables.map((remoteTable) => {
        const localTable = currentById.get(remoteTable.id);
        const dirtyFields = dirtyFieldsRef.current.get(remoteTable.id);
        if (!localTable || !dirtyFields?.size) return remoteTable;

        const preservedFields = {};
        dirtyFields.forEach((field) => {
          preservedFields[field] = localTable[field];
        });
        return { ...remoteTable, ...preservedFields };
      });
    });
  }, [tables]);

  useEffect(() => {
    // Socket yenilemeleri, kaydedilmemiş dekorasyon düzenini ezmemeli.
    if (!hasChangesRef.current) {
      const nextElements = Array.isArray(elements) ? elements : [];
      localElementsRef.current = nextElements;
      setLocalElements(nextElements);
    }
  }, [elements]);

  useEffect(() => {
    if (!hasChangesRef.current) {
      const nextCanvas = normalizeCanvas({ width: canvas?.width, height: canvas?.height });
      setLocalCanvas(nextCanvas);
      setCanvasFields({ width: String(nextCanvas.width), height: String(nextCanvas.height) });
    }
  }, [canvas?.width, canvas?.height, section]);

  useEffect(() => {
    if (!socket) return;
    const handleCanvasUpdate = (updatedCanvas) => {
      if (updatedCanvas?.section !== section || hasChangesRef.current) return;
      const nextCanvas = normalizeCanvas(updatedCanvas);
      setLocalCanvas(nextCanvas);
      setCanvasFields({ width: String(nextCanvas.width), height: String(nextCanvas.height) });
    };
    socket.on("floorplan:canvas_update", handleCanvasUpdate);
    return () => socket.off("floorplan:canvas_update", handleCanvasUpdate);
  }, [socket, section]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;

    const updateViewportSize = () => {
      const bounds = viewport.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      setViewportSize({ width: bounds.width, height: bounds.height });
    };
    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const canvasWidth = localCanvas.width;
  const canvasHeight = localCanvas.height;
  const viewportWidth = viewportSize.width;
  const viewportHeight = viewportSize.height;

  useEffect(() => {
    if (!viewportWidth || !viewportHeight) return;
    const layoutKey = `${section}:${canvasWidth}x${canvasHeight}:${isEditable}:${isEditable ? "" : `${viewportWidth}x${viewportHeight}`}`;
    if (zoomedForLayoutRef.current === layoutKey) return;
    zoomedForLayoutRef.current = layoutKey;
    zoomAnchorRef.current = null;
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0;
      viewportRef.current.scrollTop = 0;
    }
    // Editing starts at a readable working scale; service previews start fully fitted.
    setZoom(
      isEditable
        ? canvasWidth <= 1440 && canvasHeight <= 900
          ? 1
          : 0.75
        : getFloorPlanFitZoom(
            { width: viewportWidth, height: viewportHeight },
            { width: canvasWidth, height: canvasHeight }
          )
    );
  }, [section, isEditable, canvasWidth, canvasHeight, viewportWidth, viewportHeight]);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const viewport = viewportRef.current;
    const canvasNode = containerRef.current;
    if (!anchor || !viewport || !canvasNode) return;

    const bounds = canvasNode.getBoundingClientRect();
    viewport.scrollLeft += bounds.left + bounds.width * anchor.x - anchor.clientX;
    viewport.scrollTop += bounds.top + bounds.height * anchor.y - anchor.clientY;
    zoomAnchorRef.current = null;
  }, [zoom]);

  const markDirty = (tableId, fields = []) => {
    hasChangesRef.current = true;
    if (tableId && fields.length > 0) {
      const currentFields = dirtyFieldsRef.current.get(tableId) || new Set();
      fields.forEach((field) => currentFields.add(field));
      dirtyFieldsRef.current.set(tableId, currentFields);
    }
    setHasChanges(true);
    setSaveError("");
  };

  const applyCanvasDimensions = (nextCanvasValue) => {
    const nextCanvas = normalizeCanvas(nextCanvasValue);
    const result = rescaleFloorPlanLayout({
      section,
      fromCanvas: localCanvas,
      toCanvas: nextCanvas,
      tables: localTables,
      elements: localElements,
    });
    setLocalCanvas(nextCanvas);
    setCanvasFields({ width: String(nextCanvas.width), height: String(nextCanvas.height) });
    setLocalTables(result.tables);
    localElementsRef.current = result.elements;
    setLocalElements(result.elements);
    onElementsChange?.(result.elements);
    if (selectedEditTable) {
      setSelectedEditTable(
        result.tables.find((table) => table.id === selectedEditTable.id) || null
      );
    }
    result.tables.forEach((table, index) => {
      const previous = localTables[index];
      if (
        table.section === section &&
        previous &&
        (table.posX !== previous.posX || table.posY !== previous.posY)
      ) {
        const currentFields = dirtyFieldsRef.current.get(table.id) || new Set();
        currentFields.add("posX");
        currentFields.add("posY");
        dirtyFieldsRef.current.set(table.id, currentFields);
      }
    });
    markDirty();
  };

  const isCompactCanvas = zoom < 0.72;

  const getTableDimensions = (table) => getTableDisplayDimensions(table, zoom);

  const getElementDimensions = (element) => {
    const defaults = FLOOR_ELEMENT_DEFAULTS[element?.type] || FLOOR_ELEMENT_DEFAULTS.LABEL;
    return {
      widthPx: (Number(element?.width) || defaults.width) * zoom,
      heightPx: (Number(element?.height) || defaults.height) * zoom,
    };
  };

  const changeZoom = useCallback((nextZoom, clientX, clientY) => {
    const viewport = viewportRef.current;
    const canvasNode = containerRef.current;
    if (viewport && canvasNode) {
      const viewportBounds = viewport.getBoundingClientRect();
      const canvasBounds = canvasNode.getBoundingClientRect();
      const anchorClientX = clientX ?? viewportBounds.left + viewportBounds.width / 2;
      const anchorClientY = clientY ?? viewportBounds.top + viewportBounds.height / 2;
      zoomAnchorRef.current = {
        x: clamp((anchorClientX - canvasBounds.left) / Math.max(1, canvasBounds.width), 0, 1),
        y: clamp((anchorClientY - canvasBounds.top) / Math.max(1, canvasBounds.height), 0, 1),
        clientX: anchorClientX,
        clientY: anchorClientY,
      };
    }
    setZoom((currentZoom) =>
      clamp(typeof nextZoom === "function" ? nextZoom(currentZoom) : nextZoom, 0.05, 2)
    );
  }, []);

  const fitCanvasToViewport = () => {
    zoomAnchorRef.current = null;
    setZoom(getFloorPlanFitZoom(viewportSize, localCanvas));
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0;
      viewportRef.current.scrollTop = 0;
    }
  };

  const handleZoomWheel = useCallback(
    (event) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      changeZoom((currentZoom) => currentZoom * factor, event.clientX, event.clientY);
    },
    [changeZoom]
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event) => handleZoomWheel(event);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [handleZoomWheel]);

  const handleViewportKeyDown = (event) => {
    if (event.target !== viewportRef.current) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(zoom * 1.2);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(zoom / 1.2);
    } else if (event.key === "0") {
      event.preventDefault();
      fitCanvasToViewport();
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const step = event.shiftKey ? 180 : 72;
      viewportRef.current.scrollBy({
        left: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
        top: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
      });
    }
  };

  const updateCanvasDraft = (field, value) => {
    setCanvasFields((current) => ({ ...current, [field]: value }));
  };

  const commitCanvasDraft = (field) => {
    const value = Number(canvasFields[field]);
    const nextCanvas = normalizeCanvas({
      ...localCanvas,
      [field]: Number.isFinite(value) ? value : localCanvas[field],
    });
    if (nextCanvas.width !== localCanvas.width || nextCanvas.height !== localCanvas.height)
      applyCanvasDimensions(nextCanvas);
    else setCanvasFields({ width: String(nextCanvas.width), height: String(nextCanvas.height) });
  };

  const selectCanvasPreset = (preset) => {
    const nextCanvas = { width: preset.width, height: preset.height };
    if (nextCanvas.width !== localCanvas.width || nextCanvas.height !== localCanvas.height)
      applyCanvasDimensions(nextCanvas);
  };

  const updateElements = (updater) => {
    const next = typeof updater === "function" ? updater(localElementsRef.current) : updater;
    localElementsRef.current = next;
    setLocalElements(next);
    markDirty();
    onElementsChange?.(next);
  };

  const updateFloorElementProperty = (elementId, property, value) => {
    const current = localElements.find((item) => item.id === elementId);
    if (!current) return;
    const numericValue = Number(value);
    let nextValue = value;
    if (property === "width")
      nextValue = clamp(Math.round(numericValue || 8), 8, FLOOR_ELEMENT_WIDTH_MAX);
    if (property === "height")
      nextValue = clamp(Math.round(numericValue || 8), 8, FLOOR_ELEMENT_HEIGHT_MAX);
    if (property === "rotation") nextValue = normalizeFloorElementRotation(value);
    updateElements((items) =>
      items.map((item) => (item.id === elementId ? { ...item, [property]: nextValue } : item))
    );
    if (property === "width" || property === "height") {
      setElementSizeDrafts((currentDrafts) =>
        Object.fromEntries(
          Object.entries(currentDrafts).filter(([key]) => !key.startsWith(`${elementId}:`))
        )
      );
    }
  };

  const updateFloorElementAngle = (elementId, value) => {
    const numericValue = Number(value);
    const angle = clamp(Math.round(Number.isFinite(numericValue) ? numericValue : 0), 0, 359);
    updateFloorElementProperty(elementId, "rotation", angle);
  };

  const updateFloorElementDraft = (element, property, value) => {
    setElementSizeDrafts((current) => ({ ...current, [`${element.id}:${property}`]: value }));
  };

  const getFloorElementDraft = (element, property) =>
    elementSizeDrafts[`${element.id}:${property}`] ??
    String(element[property] ?? FLOOR_ELEMENT_DEFAULTS[element.type]?.[property] ?? 0);

  const commitFloorElementDraft = (element, property) => {
    const draft = elementSizeDrafts[`${element.id}:${property}`];
    if (draft !== undefined) updateFloorElementProperty(element.id, property, Number(draft));
  };

  const filteredTables = localTables.filter((tItem) => {
    return section === "ALL" || section === "TÜMÜ" || tItem.section === section;
  });
  const hasConcreteSection = Boolean(section && section !== "ALL" && section !== "TÜMÜ");
  const isLoading = tables == null;

  const handlePointerDown = (e, table) => {
    if (!isEditable) {
      if (onSelectTable) onSelectTable(table);
      return;
    }

    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    setSelectedEditTable(table);

    const tableBounds = e.currentTarget.getBoundingClientRect();

    setDragOffset({
      x: e.clientX - tableBounds.left,
      y: e.clientY - tableBounds.top,
    });
    setActiveDragId(table.id);
    setActivePointerId(e.pointerId);
    activePointerTargetRef.current = e.currentTarget;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleCanvasPointerDown = (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.button !== undefined && event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    panStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setActivePan(true);
    setActivePointerId(event.pointerId);
    activePointerTargetRef.current = event.currentTarget;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (e) => {
    if (activePan && panStartRef.current && viewportRef.current) {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      viewportRef.current.scrollLeft =
        panStartRef.current.scrollLeft - (e.clientX - panStartRef.current.x);
      viewportRef.current.scrollTop =
        panStartRef.current.scrollTop - (e.clientY - panStartRef.current.y);
      return;
    }
    if (isEditable && activeElementDragId && containerRef.current) {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      const containerNode = containerRef.current;
      const container = containerNode.getBoundingClientRect();
      const containerWidth = containerNode.clientWidth;
      const containerHeight = containerNode.clientHeight;
      const canvasLeft = container.left + containerNode.clientLeft;
      const canvasTop = container.top + containerNode.clientTop;
      const activeElement = localElements.find((item) => item.id === activeElementDragId);
      if (!activeElement || !containerWidth || !containerHeight) return;
      const { widthPx, heightPx } = getElementDimensions(activeElement);
      const rotatedBounds = getRotatedFloorElementBounds(widthPx, heightPx, activeElement.rotation);
      const nextX = clampRotatedFloorPlanPosition(
        ((e.clientX - canvasLeft - elementDragOffset.x) / containerWidth) * 100,
        containerWidth,
        widthPx,
        rotatedBounds.widthPx
      );
      const nextY = clampRotatedFloorPlanPosition(
        ((e.clientY - canvasTop - elementDragOffset.y) / containerHeight) * 100,
        containerHeight,
        heightPx,
        rotatedBounds.heightPx
      );
      updateElements((current) =>
        current.map((item) =>
          item.id === activeElementDragId ? { ...item, posX: nextX, posY: nextY } : item
        )
      );
      return;
    }
    if (!isEditable || !activeDragId || !containerRef.current) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;

    const container = containerRef.current.getBoundingClientRect();
    const activeTable = localTables.find((table) => table.id === activeDragId);
    const { widthPx, heightPx, chairOffsetPx } = getTableDimensions(activeTable);
    const newX = clampTablePosition(
      ((e.clientX - container.left - dragOffset.x) / container.width) * 100,
      container.width,
      widthPx,
      chairOffsetPx
    );
    const newY = clampTablePosition(
      ((e.clientY - container.top - dragOffset.y) / container.height) * 100,
      container.height,
      heightPx,
      chairOffsetPx
    );

    setLocalTables((prev) =>
      prev.map((tItem) => {
        if (tItem.id === activeDragId) {
          const updated = { ...tItem, posX: newX, posY: newY };
          if (selectedEditTable?.id === activeDragId) {
            setSelectedEditTable(updated);
          }
          return updated;
        }
        return tItem;
      })
    );
    markDirty(activeDragId, ["posX", "posY"]);
  };

  const handlePointerUp = (e) => {
    if (!activeDragId && !activeElementDragId && !activePan) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;

    try {
      if (activePointerId !== null) {
        activePointerTargetRef.current?.releasePointerCapture?.(activePointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    activePointerTargetRef.current = null;
    panStartRef.current = null;
    setActivePan(false);
    setActiveDragId(null);
    setActiveElementDragId(null);
    setActivePointerId(null);
  };

  const handlePointerCancel = (e) => handlePointerUp(e);

  // Masa İsim / Numara Güncelleme
  const updateTableName = (tableId, newName) => {
    setLocalTables((prev) =>
      prev.map((tItem) => {
        if (tItem.id === tableId) {
          const updated = { ...tItem, tableNumber: newName };
          setSelectedEditTable(updated);
          return updated;
        }
        return tItem;
      })
    );
    markDirty(tableId, ["tableNumber"]);
  };

  // Masa Şekil Güncelleme
  const updateTableShape = (tableId, newShape) => {
    setLocalTables((prev) =>
      prev.map((tItem) => {
        if (tItem.id === tableId) {
          let width = tItem.width || 85;
          let height = tItem.height || 85;
          if (newShape === "RECTANGLE") {
            width = 135;
            height = 85;
          } else if (newShape === "ROUND" || newShape === "SQUARE") {
            width = 85;
            height = 85;
          }
          const updated = { ...tItem, shape: newShape, width, height };
          setSelectedEditTable(updated);
          return updated;
        }
        return tItem;
      })
    );
    setTableSizeDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${tableId}:`)))
    );
    markDirty(tableId, ["shape", "width", "height"]);
  };

  const updateTableDimensions = (tableId, dimensions) => {
    const currentTable = localTables.find((item) => item.id === tableId);
    if (!currentTable) return;
    let width = clamp(
      Math.round(Number(dimensions.width ?? currentTable.width) || TABLE_SIZE_MIN),
      TABLE_SIZE_MIN,
      TABLE_SIZE_MAX
    );
    let height = clamp(
      Math.round(Number(dimensions.height ?? currentTable.height) || TABLE_SIZE_MIN),
      TABLE_SIZE_MIN,
      TABLE_SIZE_MAX
    );
    if (currentTable.shape === "ROUND" || currentTable.shape === "SQUARE") {
      const diameter = dimensions.width !== undefined ? width : height;
      width = diameter;
      height = diameter;
    }
    const container = containerRef.current?.getBoundingClientRect();
    const nextDimensions = getTableDimensions({ ...currentTable, width, height });
    const nextTable = {
      ...currentTable,
      width,
      height,
      ...(container
        ? {
            posX: clampTablePosition(
              Number(currentTable.posX) || 0,
              container.width,
              nextDimensions.widthPx,
              nextDimensions.chairOffsetPx
            ),
            posY: clampTablePosition(
              Number(currentTable.posY) || 0,
              container.height,
              nextDimensions.heightPx,
              nextDimensions.chairOffsetPx
            ),
          }
        : {}),
    };
    setLocalTables((prev) => prev.map((item) => (item.id === tableId ? nextTable : item)));
    setSelectedEditTable(nextTable);
    setTableSizeDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${tableId}:`)))
    );
    markDirty(tableId, ["width", "height", "posX", "posY"]);
  };

  const getTableSizeDraft = (table, field) =>
    tableSizeDrafts[`${table.id}:${field}`] ?? String(Number(table[field]) || 85);

  const updateTableSizeDraft = (table, field, value) => {
    setTableSizeDrafts((current) => ({ ...current, [`${table.id}:${field}`]: value }));
  };

  const commitTableSizeDraft = (table, field) => {
    const draft = tableSizeDrafts[`${table.id}:${field}`];
    if (draft === undefined) return;
    updateTableDimensions(table.id, { [field]: Number(draft) });
  };

  // Table size presets include a long banquet option for communal dining.
  const setTableSizePreset = (tableId, sizeType) => {
    const table = localTables.find((item) => item.id === tableId);
    if (!table) return;
    updateTableDimensions(tableId, getTableSizePresetDimensions(table, sizeType));
  };

  /* Kept as a separate updater so capacity changes never disturb table geometry. */
  const updateTableCapacity = (tableId, delta) => {
    setLocalTables((prev) =>
      prev.map((tItem) => {
        if (tItem.id === tableId) {
          const nextCap = Math.max(1, Math.min(30, (tItem.capacity || 4) + delta));
          const updated = { ...tItem, capacity: nextCap };
          setSelectedEditTable(updated);
          return updated;
        }
        return tItem;
      })
    );
    markDirty(tableId, ["capacity"]);
  };

  const moveTableByKeyboard = (event, table) => {
    if (!isEditable || !containerRef.current) return;

    const step = event.shiftKey ? 5 : 1;
    const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (deltaX === 0 && deltaY === 0) return;

    event.preventDefault();
    const container = containerRef.current.getBoundingClientRect();
    const { widthPx, heightPx, chairOffsetPx } = getTableDimensions(table);
    const nextX = clampTablePosition(
      (Number(table.posX) || 0) + deltaX,
      container.width,
      widthPx,
      chairOffsetPx
    );
    const nextY = clampTablePosition(
      (Number(table.posY) || 0) + deltaY,
      container.height,
      heightPx,
      chairOffsetPx
    );

    const updatedTable = { ...table, posX: nextX, posY: nextY };
    setLocalTables((prev) => prev.map((item) => (item.id === table.id ? updatedTable : item)));
    setSelectedEditTable(updatedTable);
    markDirty(table.id, ["posX", "posY"]);
  };

  const handleTableKeyDown = (event, table) => {
    if (isEditable) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSelectedElementId(null);
        setSelectedEditTable(table);
        return;
      }
      moveTableByKeyboard(event, table);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (onSelectTable) onSelectTable(table);
    }
  };

  const handleElementPointerDown = (event, element) => {
    if (!isEditable || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const containerNode = containerRef.current;
    const containerBounds = containerNode.getBoundingClientRect();
    const canvasLeft = containerBounds.left + containerNode.clientLeft;
    const canvasTop = containerBounds.top + containerNode.clientTop;
    setSelectedEditTable(null);
    setSelectedElementId(element.id);
    setElementDragOffset({
      x: event.clientX - canvasLeft - event.currentTarget.offsetLeft,
      y: event.clientY - canvasTop - event.currentTarget.offsetTop,
    });
    setActiveElementDragId(element.id);
    setActivePointerId(event.pointerId);
    activePointerTargetRef.current = event.currentTarget;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleElementKeyDown = (event, element) => {
    if (!isEditable || !containerRef.current) return;
    if ((event.key === "Delete" || event.key === "Backspace") && onDeleteElement) {
      event.preventDefault();
      onDeleteElement(element);
      updateElements((current) => current.filter((item) => item.id !== element.id));
      setSelectedElementId(null);
      return;
    }
    const step = event.shiftKey ? 5 : 1;
    const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (!deltaX && !deltaY) return;
    event.preventDefault();
    const containerNode = containerRef.current;
    const { widthPx, heightPx } = getElementDimensions(element);
    const rotatedBounds = getRotatedFloorElementBounds(widthPx, heightPx, element.rotation);
    const nextX = clampRotatedFloorPlanPosition(
      (Number(element.posX) || 0) + deltaX,
      containerNode.clientWidth,
      widthPx,
      rotatedBounds.widthPx
    );
    const nextY = clampRotatedFloorPlanPosition(
      (Number(element.posY) || 0) + deltaY,
      containerNode.clientHeight,
      heightPx,
      rotatedBounds.heightPx
    );
    updateElements((current) =>
      current.map((item) => (item.id === element.id ? { ...item, posX: nextX, posY: nextY } : item))
    );
  };

  const addFloorElement = (type) => {
    const defaults = FLOOR_ELEMENT_DEFAULTS[type] || FLOOR_ELEMENT_DEFAULTS.LABEL;
    const targetSection = hasConcreteSection ? section : localTables[0]?.section || "İç Mekan";
    const newElement = {
      id: `floor-${type.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      section: targetSection,
      type,
      posX: 8 + ((localElements.length * 7) % 56),
      posY: 8 + ((localElements.length * 9) % 54),
      width: defaults.width,
      height: defaults.height,
      rotation: 0,
      label: "",
    };
    updateElements((current) => [...current, newElement]);
    setSelectedEditTable(null);
    setSelectedElementId(newElement.id);
    onAddElement?.(newElement);
  };

  const getUniqueTableNumber = (targetSection) => {
    const prefix =
      { "İç Mekan": "İ", Bahçe: "B", Teras: "T" }[targetSection] ||
      String(targetSection).trim().charAt(0).toLocaleUpperCase("tr-TR") ||
      "M";
    const existingNames = new Set(
      localTables.map((table) => String(table.tableNumber || "").toLocaleUpperCase("tr-TR"))
    );
    let nextNumber = 1;
    while (existingNames.has(`${prefix}-${nextNumber}`.toLocaleUpperCase("tr-TR"))) nextNumber += 1;
    return `${prefix}-${nextNumber}`;
  };

  const findFreeTablePosition = (targetSection, tableWidth, tableHeight) => {
    const result = locateFreeTablePosition({
      section: targetSection,
      canvas: localCanvas,
      tables: localTables,
      width: tableWidth,
      height: tableHeight,
    });
    if (!result) return null;
    if (result.canvas.width !== localCanvas.width || result.canvas.height !== localCanvas.height) {
      applyCanvasDimensions(result.canvas);
    }
    return result.position;
  };

  const createTable = async (sourceTable = null) => {
    if (!onAddTable || isAddingTable) return;

    const targetSection =
      section && section !== "ALL" && section !== "TÜMÜ"
        ? section
        : localTables[0]?.section || "İç Mekan";
    const shape = sourceTable?.shape || "SQUARE";
    const width = clamp(
      Number(sourceTable?.width) || (shape === "RECTANGLE" ? 150 : 90),
      TABLE_SIZE_MIN,
      TABLE_SIZE_MAX
    );
    const height = clamp(Number(sourceTable?.height) || 90, TABLE_SIZE_MIN, TABLE_SIZE_MAX);
    const position = findFreeTablePosition(targetSection, width, height);
    if (!position) {
      setSaveError(
        lang === "tr"
          ? "Bu salonda masa için yer kalmadı. Önce salon boyutunu artırın."
          : "There is no room left for a table. Increase the venue size first."
      );
      return;
    }

    setIsAddingTable(true);
    setSaveError("");
    try {
      const createdTable = await onAddTable({
        tableNumber: getUniqueTableNumber(targetSection),
        capacity: sourceTable?.capacity || 4,
        section: targetSection,
        posX: position.posX,
        posY: position.posY,
        shape,
        width,
        height,
      });
      if (!createdTable?.id) throw new Error("table-create-failed");

      const normalizedTable = { ...createdTable, orders: createdTable.orders || [] };
      setLocalTables((current) =>
        current.some((table) => table.id === normalizedTable.id)
          ? current.map((table) => (table.id === normalizedTable.id ? normalizedTable : table))
          : [...current, normalizedTable]
      );
      setSelectedElementId(null);
      setSelectedEditTable(normalizedTable);
    } catch (error) {
      console.error(error);
      setSaveError(
        lang === "tr"
          ? "Yeni masa eklenemedi. Tekrar deneyin."
          : "The new table could not be added. Try again."
      );
    } finally {
      setIsAddingTable(false);
    }
  };

  const addTable = () => createTable();
  const duplicateSelectedTable = () => selectedEditTable && createTable(selectedEditTable);

  const deleteSelectedElement = () => {
    const selected = localElements.find((item) => item.id === selectedElementId);
    if (!selected) return;
    onDeleteElement?.(selected);
    updateElements((current) => current.filter((item) => item.id !== selected.id));
    setSelectedElementId(null);
  };

  // Kroki & Masaları Kaydet
  const saveLayout = async () => {
    setIsSaving(true);
    setSaveError("");
    let saveStage = "tables";
    try {
      const sectionTables = hasConcreteSection
        ? localTables.filter((tItem) => tItem.section === section)
        : [];
      const payload = sectionTables.map((tItem) => ({
        id: tItem.id,
        tableNumber: tItem.tableNumber,
        posX: tItem.posX,
        posY: tItem.posY,
        shape: tItem.shape,
        width: tItem.width || 85,
        height: tItem.height || 85,
        capacity: tItem.capacity,
      }));

      const res = await fetch("/api/tables/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tables: payload }),
      });
      if (!res.ok) throw new Error("layout-save-failed");

      saveStage = "canvas";
      if (section && section !== "ALL" && section !== "TÜMÜ") {
        const canvasRes = await fetch("/api/floor-plan/canvas", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, ...localCanvas }),
        });
        if (!canvasRes.ok) throw new Error("canvas-save-failed");
      }

      saveStage = "elements";
      if (onSaveLayout) await onSaveLayout(localElements, localCanvas);

      hasChangesRef.current = false;
      dirtyFieldsRef.current.clear();
      setHasChanges(false);
      setSelectedEditTable(null);
    } catch (e) {
      console.error(e);
      const messages = {
        tables:
          lang === "tr"
            ? "Masa düzeni kaydedilemedi. Değişiklikler korunuyor; tekrar deneyin."
            : "Table layout could not be saved. Changes are preserved; try again.",
        canvas:
          lang === "tr"
            ? "Masa düzeni kaydedildi, salon boyutu kaydedilemedi. Tekrar deneyin."
            : "Table layout saved, but venue size could not be saved. Try again.",
        elements:
          lang === "tr"
            ? "Masa ve salon düzeni kaydedildi, dekorasyon öğeleri kaydedilemedi. Tekrar deneyin."
            : "Tables and venue size saved, but floor elements could not be saved. Try again.",
      };
      setSaveError(messages[saveStage]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`floorplan-root h-full w-full flex flex-col min-h-0 select-none ${isEditable ? "floorplan-editor" : ""}`}
    >
      {/* Service/edit mode is intentionally explicit in every use of the shared canvas. */}
      {showModeBar && (
        <div className="floor-mode-bar mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2 text-xs">
          <div className="flex min-w-0 items-center gap-2 text-[var(--accent)]">
            <span
              role="status"
              className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 font-bold tracking-[0.02em] ${
                isEditable
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                  : "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-secondary)]"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${isEditable ? "bg-[var(--accent)]" : "bg-[var(--success)]"}`}
              />
              {isEditable
                ? lang === "tr"
                  ? "DÜZENLEME MODU"
                  : "EDIT MODE"
                : lang === "tr"
                  ? "OPERASYON MODU"
                  : "SERVICE MODE"}
            </span>
            <span className="truncate text-[var(--text-secondary)]">
              {isEditable
                ? `${t("dragInstructions")} ${lang === "tr" ? "Ok tuşlarıyla da taşıyabilirsiniz." : "Arrow keys also move a table."}`
                : lang === "tr"
                  ? "Masaya dokunarak masa işlemlerini açın."
                  : "Select a table to open its actions."}
            </span>
            {isEditable && hasChanges && (
              <span
                role="status"
                className="floorplan-unsaved-status shrink-0 rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] px-2 py-1 text-[10px] font-semibold text-[var(--warning)]"
              >
                {lang === "tr" ? "Kaydedilmemiş değişiklikler" : "Unsaved changes"}
              </span>
            )}
          </div>

          {isEditable && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {saveError && (
                <span role="alert" className="max-w-[30rem] text-[var(--danger)]">
                  {saveError}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  hasChangesRef.current = false;
                  dirtyFieldsRef.current.clear();
                  setLocalTables(Array.isArray(tables) ? tables : []);
                  const resetElements = Array.isArray(elements) ? elements : [];
                  localElementsRef.current = resetElements;
                  setLocalElements(resetElements);
                  const resetCanvas = normalizeCanvas(canvas);
                  setLocalCanvas(resetCanvas);
                  setCanvasFields({
                    width: String(resetCanvas.width),
                    height: String(resetCanvas.height),
                  });
                  setSelectedEditTable(null);
                  setSelectedElementId(null);
                  setHasChanges(false);
                  setSaveError("");
                }}
                disabled={!hasChanges || isSaving}
                className="secondary-action min-h-11 px-3 disabled:opacity-40"
              >
                {t("reset")}
              </button>
              <button
                type="button"
                onClick={saveLayout}
                disabled={!hasChanges || isSaving}
                className="primary-action flex min-h-11 items-center gap-1.5 px-4 font-semibold active:scale-[0.98] disabled:opacity-40"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? t("saving") : t("saveLayout")}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {isEditable && showElementTools && (
        <details className="floor-tool-disclosure floor-add-tools">
          <summary>{lang === "tr" ? "Masa ve dekor ekle" : "Add tables and decor"}</summary>
          <div
            className="mb-2 flex shrink-0 items-center gap-1.5 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1.5"
            role="toolbar"
            aria-label={
              lang === "tr" ? "Krokiye masa ve öğe ekle" : "Add tables and floor-plan elements"
            }
          >
            <button
              type="button"
              onClick={addTable}
              disabled={!onAddTable || isAddingTable}
              className="primary-action inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {isAddingTable
                ? lang === "tr"
                  ? "Ekleniyor…"
                  : "Adding…"
                : lang === "tr"
                  ? "Masa ekle"
                  : "Add table"}
            </button>
            <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-[var(--border)]" />
            <span className="shrink-0 px-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
              {lang === "tr" ? "Dekorasyon" : "Decor"}
            </span>
            {FLOOR_ELEMENT_TYPES.map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => addFloorElement(type)}
                className="secondary-action min-h-10 shrink-0 px-2.5 text-xs font-medium"
              >
                + {getFloorElementLabel({ type }, lang)}
              </button>
            ))}
          </div>
        </details>
      )}

      {isEditable && hasConcreteSection && (
        <details className="floor-tool-disclosure floor-size-tools">
          <summary>{lang === "tr" ? "Salon ölçüleri" : "Venue dimensions"}</summary>
          <div
            className="floorplan-canvas-settings mb-2 flex shrink-0 flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2"
            role="group"
            aria-label={lang === "tr" ? "Salon boyutu" : "Venue size"}
          >
            <div className="floorplan-canvas-presets flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] font-semibold text-[var(--text-secondary)]">
                {lang === "tr" ? "Salon" : "Venue"}
              </span>
              {CANVAS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectCanvasPreset(preset)}
                  aria-pressed={
                    localCanvas.width === preset.width && localCanvas.height === preset.height
                  }
                  className={`min-h-9 rounded-md border px-2 text-[11px] font-medium ${localCanvas.width === preset.width && localCanvas.height === preset.height ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "border-[var(--border)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
                >
                  {preset[lang === "tr" ? "tr" : "en"]}
                </button>
              ))}
            </div>
            <label className="floorplan-canvas-field text-[10px] font-semibold text-[var(--text-muted)]">
              {lang === "tr" ? "Genişlik" : "Width"}
              <input
                type="number"
                min={CANVAS_MIN_WIDTH}
                max={CANVAS_MAX}
                step={50}
                value={canvasFields.width}
                onChange={(event) => updateCanvasDraft("width", event.target.value)}
                onBlur={() => commitCanvasDraft("width")}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                aria-label={lang === "tr" ? "Salon genişliği" : "Venue width"}
                className="min-h-9 w-[5.5rem] rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-2 text-xs font-semibold tabular-nums text-[var(--text-primary)]"
              />
            </label>
            <label className="floorplan-canvas-field text-[10px] font-semibold text-[var(--text-muted)]">
              {lang === "tr" ? "Derinlik" : "Depth"}
              <input
                type="number"
                min={CANVAS_MIN_HEIGHT}
                max={CANVAS_MAX}
                step={50}
                value={canvasFields.height}
                onChange={(event) => updateCanvasDraft("height", event.target.value)}
                onBlur={() => commitCanvasDraft("height")}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                aria-label={lang === "tr" ? "Salon derinliği" : "Venue depth"}
                className="min-h-9 w-[5.5rem] rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-2 text-xs font-semibold tabular-nums text-[var(--text-primary)]"
              />
            </label>
            <span className="ml-auto pb-2 text-[10px] tabular-nums text-[var(--text-muted)]">
              {lang === "tr" ? "Düzen birimi" : "Layout units"}
            </span>
          </div>
        </details>
      )}

      <div className="floorplan-zoom-bar mb-2 flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={lang === "tr" ? "Kroki yakınlaştırma" : "Floor plan zoom"}
        >
          <button
            type="button"
            onClick={() => changeZoom(zoom / 1.2)}
            disabled={zoom <= 0.05}
            aria-label={lang === "tr" ? "Uzaklaştır" : "Zoom out"}
            className="secondary-action flex min-h-10 min-w-10 items-center justify-center disabled:opacity-40"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <output
            className="min-w-12 text-center text-xs font-semibold tabular-nums text-[var(--text-primary)]"
            aria-live="polite"
            aria-label={lang === "tr" ? "Yakınlaştırma düzeyi" : "Zoom level"}
          >
            {Math.round(zoom * 100)}%
          </output>
          <button
            type="button"
            onClick={() => changeZoom(zoom * 1.2)}
            disabled={zoom >= 2}
            aria-label={lang === "tr" ? "Yakınlaştır" : "Zoom in"}
            className="secondary-action flex min-h-10 min-w-10 items-center justify-center disabled:opacity-40"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => changeZoom(1)}
            className="secondary-action min-h-10 px-2.5 text-xs font-medium"
          >
            {lang === "tr" ? "%100" : "100%"}
          </button>
          <button
            type="button"
            onClick={fitCanvasToViewport}
            className="secondary-action flex min-h-10 items-center gap-1.5 px-2.5 text-xs font-medium"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            {lang === "tr" ? "Planı sığdır" : "Fit plan"}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="secondary-action flex min-h-10 items-center gap-1.5 px-2.5 text-xs font-medium"
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            {isFullscreen
              ? lang === "tr"
                ? "Tam ekrandan çık"
                : "Exit full screen"
              : isEditable
                ? lang === "tr"
                  ? "Tam ekranda düzenle"
                  : "Edit full screen"
                : lang === "tr"
                  ? "Krokiyi tam ekranda göster"
                  : "Show floor plan full screen"}
          </button>
        </div>
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          {lang === "tr"
            ? "Boş alanı sürükleyin · Ctrl+tekerlek yakınlaştırır · Oklar kaydırır"
            : "Drag empty space · Ctrl+wheel zooms · Arrow keys pan"}
        </span>
      </div>
      {fullscreenError && (
        <div role="alert" className="mb-2 text-xs text-[var(--danger)]">
          {fullscreenError}
        </div>
      )}

      <div
        ref={viewportRef}
        className="floorplan-viewport flex min-h-0 flex-1"
        onKeyDown={handleViewportKeyDown}
        tabIndex={0}
        role="region"
        aria-label={
          lang === "tr"
            ? "Kroki görünüm alanı. Ok tuşlarıyla kaydırın, artı ve eksiyle yakınlaştırın."
            : "Floor plan viewport. Use arrow keys to pan and plus or minus to zoom."
        }
      >
        <div
          ref={containerRef}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerUp}
          role="region"
          tabIndex={-1}
          aria-label={
            isEditable
              ? lang === "tr"
                ? "Düzenlenebilir restoran krokisi"
                : "Editable restaurant floor plan"
              : lang === "tr"
                ? "Restoran krokisi"
                : "Restaurant floor plan"
          }
          style={{
            width: `${localCanvas.width * zoom}px`,
            height: `${localCanvas.height * zoom}px`,
            backgroundSize: `${32 * zoom}px ${32 * zoom}px`,
          }}
          className={`floorplan-stage bg-dot-grid relative shrink-0 touch-none overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-strong)] ${activePan ? "is-panning" : ""}`}
        >
          {isLoading ? (
            <div
              role="status"
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--accent)] text-sm"
            >
              <div className="h-8 w-8 rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)] animate-spin" />
              <span>{lang === "tr" ? "Kroki yükleniyor…" : "Loading floor plan…"}</span>
            </div>
          ) : filteredTables.length === 0 && localElements.length === 0 ? (
            <div
              role="status"
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-[var(--text-secondary)] text-sm"
            >
              <Layers className="h-7 w-7 text-[var(--text-muted)]" strokeWidth={1.5} />
              <span className="font-semibold text-[var(--text-primary)]">
                {lang === "tr" ? "Bu bölümde masa yok" : "No tables in this section"}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {isEditable
                  ? lang === "tr"
                    ? "Yeni masa ekleyerek krokide başlayın."
                    : "Add a table to start this floor plan."
                  : lang === "tr"
                    ? "Başka bir bölüm seçin."
                    : "Choose another section."}
              </span>
            </div>
          ) : (
            <>
              {localElements.map((element) => (
                <FloorElement
                  key={element.id}
                  element={element}
                  lang={lang}
                  editable={isEditable}
                  selected={selectedElementId === element.id}
                  dimensions={getElementDimensions(element)}
                  onPointerDown={(event) => handleElementPointerDown(event, element)}
                  onKeyDown={(event) => handleElementKeyDown(event, element)}
                  onSelect={() => {
                    setSelectedEditTable(null);
                    setSelectedElementId(element.id);
                  }}
                />
              ))}
              {filteredTables.map((table) => (
                <TableNode
                  key={table.id}
                  table={table}
                  zoom={zoom}
                  isCompactCanvas={isCompactCanvas}
                  isEditable={isEditable}
                  selectedEditTableId={selectedEditTable?.id}
                  selectedTableId={selectedTableId}
                  translate={t}
                  onPointerDown={handlePointerDown}
                  onKeyDown={handleTableKeyDown}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {isEditable && selectedElementId && (
        <div className="floorplan-selection-panel surface-soft mt-2 flex shrink-0 flex-wrap items-center gap-3 p-3 text-xs">
          {(() => {
            const element = localElements.find((item) => item.id === selectedElementId);
            if (!element) return null;
            return (
              <>
                <span className="font-semibold text-[var(--text-primary)]">
                  {getFloorElementLabel(element, lang)}
                </span>
                <span className="text-[var(--text-secondary)]">
                  {lang === "tr"
                    ? "Sürükleyin veya ok tuşlarıyla taşıyın. Shift daha hızlı taşır."
                    : "Drag or use arrow keys. Shift moves faster."}
                </span>
                <label className="floorplan-size-field font-semibold text-[var(--text-muted)]">
                  {lang === "tr" ? "Genişlik" : "Width"}
                  <input
                    type="number"
                    min={8}
                    max={FLOOR_ELEMENT_WIDTH_MAX}
                    step={10}
                    value={getFloorElementDraft(element, "width")}
                    onChange={(event) =>
                      updateFloorElementDraft(element, "width", event.target.value)
                    }
                    onBlur={() => commitFloorElementDraft(element, "width")}
                    onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                    aria-label={lang === "tr" ? "Öğe genişliği" : "Element width"}
                    className="min-h-10 w-20 rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-2 text-xs font-semibold tabular-nums text-[var(--text-primary)]"
                  />
                </label>
                <label className="floorplan-size-field font-semibold text-[var(--text-muted)]">
                  {lang === "tr" ? "Yükseklik" : "Height"}
                  <input
                    type="number"
                    min={8}
                    max={FLOOR_ELEMENT_HEIGHT_MAX}
                    step={10}
                    value={getFloorElementDraft(element, "height")}
                    onChange={(event) =>
                      updateFloorElementDraft(element, "height", event.target.value)
                    }
                    onBlur={() => commitFloorElementDraft(element, "height")}
                    onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                    aria-label={lang === "tr" ? "Öğe yüksekliği" : "Element height"}
                    className="min-h-10 w-20 rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-2 text-xs font-semibold tabular-nums text-[var(--text-primary)]"
                  />
                </label>
                <label className="floorplan-size-field font-semibold text-[var(--text-muted)]">
                  {lang === "tr" ? "Açı" : "Angle"}
                  <input
                    type="number"
                    min={0}
                    max={359}
                    step={1}
                    value={normalizeFloorElementRotation(element.rotation)}
                    onChange={(event) => updateFloorElementAngle(element.id, event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                    aria-label={lang === "tr" ? "Öğe açısı" : "Element angle"}
                    className="min-h-10 w-20 rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-2 text-xs font-semibold tabular-nums text-[var(--text-primary)]"
                  />
                </label>
                <output
                  aria-label={lang === "tr" ? "Mevcut öğe açısı" : "Current element angle"}
                  className="rounded-md bg-[var(--surface)] px-2 py-2 font-semibold tabular-nums text-[var(--text-primary)]"
                >
                  {normalizeFloorElementRotation(element.rotation)}°
                </output>
                <div
                  className="flex items-center gap-1"
                  role="group"
                  aria-label={lang === "tr" ? "Öğeyi döndür" : "Rotate element"}
                >
                  <button
                    type="button"
                    onClick={() =>
                      updateFloorElementProperty(
                        element.id,
                        "rotation",
                        Number(element.rotation || 0) - 15
                      )
                    }
                    aria-label={lang === "tr" ? "Sola 15 derece döndür" : "Rotate left 15 degrees"}
                    className="secondary-action flex min-h-10 items-center gap-1 px-2 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    15°
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateFloorElementProperty(
                        element.id,
                        "rotation",
                        Number(element.rotation || 0) + 15
                      )
                    }
                    aria-label={lang === "tr" ? "Sağa 15 derece döndür" : "Rotate right 15 degrees"}
                    className="secondary-action flex min-h-10 items-center gap-1 px-2 text-xs"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    15°
                  </button>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={deleteSelectedElement}
                    className="min-h-11 rounded-lg border border-[var(--danger-border)] px-3 text-[var(--danger)] hover:bg-[var(--danger-surface)]"
                  >
                    {lang === "tr" ? "Öğeyi sil" : "Delete element"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedElementId(null)}
                    aria-label={t("close")}
                    className="secondary-action min-h-11 min-w-11 rounded-lg"
                  >
                    <X className="mx-auto h-4 w-4" />
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {isEditable && selectedEditTable && (
        <TableEditorPanel
          table={selectedEditTable}
          lang={lang}
          translate={t}
          isAddingTable={isAddingTable}
          canDuplicate={Boolean(onAddTable)}
          getSizeDraft={(field) => getTableSizeDraft(selectedEditTable, field)}
          onNameChange={(value) => updateTableName(selectedEditTable.id, value)}
          onShapeChange={(shape) => updateTableShape(selectedEditTable.id, shape)}
          onSizePreset={(preset) => setTableSizePreset(selectedEditTable.id, preset)}
          onSizeDraftChange={(field, value) =>
            updateTableSizeDraft(selectedEditTable, field, value)
          }
          onSizeCommit={(field) => commitTableSizeDraft(selectedEditTable, field)}
          onCapacityChange={(delta) => updateTableCapacity(selectedEditTable.id, delta)}
          onDuplicate={duplicateSelectedTable}
          onDelete={onDeleteTable}
          onClose={() => setSelectedEditTable(null)}
        />
      )}
    </div>
  );
}
