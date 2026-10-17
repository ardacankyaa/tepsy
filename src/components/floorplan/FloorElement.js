"use client";

const ELEMENT_LABELS = {
  WALL: { tr: "Duvar", en: "Wall" },
  DOOR: { tr: "Kapı", en: "Door" },
  WINDOW: { tr: "Pencere", en: "Window" },
  WC: { tr: "Tuvalet", en: "Restroom" },
  BAR: { tr: "Bar", en: "Bar" },
  KITCHEN: { tr: "Mutfak", en: "Kitchen" },
  PLANT: { tr: "Bitki", en: "Plant" },
  COUNTER: { tr: "Kasa", en: "Counter" },
  LABEL: { tr: "Alan etiketi", en: "Area label" },
};

export function getFloorElementLabel(element, lang = "tr") {
  return element?.label || ELEMENT_LABELS[element?.type]?.[lang] || element?.type || "Element";
}

export const FLOOR_ELEMENT_TYPES = Object.keys(ELEMENT_LABELS);

export const FLOOR_ELEMENT_DEFAULTS = {
  WALL: { width: 180, height: 14 },
  DOOR: { width: 82, height: 58 },
  WINDOW: { width: 112, height: 16 },
  WC: { width: 78, height: 78 },
  BAR: { width: 150, height: 56 },
  KITCHEN: { width: 154, height: 84 },
  PLANT: { width: 48, height: 48 },
  COUNTER: { width: 138, height: 48 },
  LABEL: { width: 126, height: 34 },
};

function ElementArtwork({ type, label, lang }) {
  if (type === "WALL") {
    return (
      <div className="floor-elem-wall h-full w-full rounded-[2px] border border-[#829486] bg-[#b7c2b7] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]" />
    );
  }

  if (type === "DOOR") {
    return (
      <div className="floor-elem-door relative h-full w-full border-b-2 border-[#778c7a]">
        <span className="absolute bottom-0 left-0 h-full w-full rounded-tr-full border-r-2 border-t-2 border-[#829b85]/80" />
        <span className="absolute bottom-0 left-0 h-1.5 w-1.5 rounded-full bg-[#31553c]" />
        <span className="absolute bottom-0 left-0 h-[2px] w-full origin-left -rotate-[38deg] bg-[#31553c]" />
      </div>
    );
  }

  if (type === "WINDOW") {
    return (
      <div className="floor-elem-window relative h-full w-full border-y-2 border-[#64836b] bg-[#e1ebe2]">
        <span className="absolute inset-y-0 left-1/2 w-px bg-[#718e76]" />
        <span className="absolute left-1/4 top-0 h-full w-px bg-[#a1b5a3]" />
        <span className="absolute left-3/4 top-0 h-full w-px bg-[#a1b5a3]" />
      </div>
    );
  }

  if (type === "PLANT") {
    return (
      <div className="floor-elem-plant relative h-full w-full" aria-hidden="true">
        <span className="absolute bottom-1 left-1/2 h-4 w-7 -translate-x-1/2 rounded-b-xl border border-[#8a7057] bg-[#604f40]" />
        <span className="absolute bottom-4 left-[42%] h-7 w-3 origin-bottom -rotate-45 rounded-full bg-[#52705c]" />
        <span className="absolute bottom-4 right-[42%] h-7 w-3 origin-bottom rotate-45 rounded-full bg-[#66816b]" />
        <span className="absolute bottom-5 left-1/2 h-7 w-3 -translate-x-1/2 rounded-full bg-[#78917a]" />
      </div>
    );
  }

  if (type === "WC") {
    return (
      <div className="floor-elem-wc flex h-full w-full flex-col items-center justify-center rounded-lg border-2 border-[#829b85] bg-[#edf1e8] text-[#294835]">
        <span className="flex items-end gap-2" aria-hidden="true">
          <span className="flex flex-col items-center">
            <i className="h-2.5 w-2.5 rounded-full bg-current" />
            <i className="mt-1 h-6 w-2 rounded-xs bg-current" />
          </span>
          <span className="h-8 w-px bg-[#aab8a8]" />
          <span className="flex flex-col items-center">
            <i className="h-2.5 w-2.5 rounded-full bg-current" />
            <i className="mt-1 h-6 w-3 rounded-t-full bg-current" />
          </span>
        </span>
        <span className="mt-1 text-[9px] font-black tracking-[0.16em]">WC</span>
      </div>
    );
  }

  if (type === "KITCHEN") {
    return (
      <div className="floor-elem-kitchen flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed border-[#81957f] bg-[#e7eee5] text-center text-[10px] font-semibold tracking-[0.05em] text-[#34543a]">
        <span>
          <span className="mb-1 block text-lg font-normal" aria-hidden="true">
            ♨
          </span>
          {label || (lang === "tr" ? "MUTFAK" : "KITCHEN")}
        </span>
      </div>
    );
  }

  const isBar = type === "BAR";
  const isCounter = type === "COUNTER";
  if (isBar || isCounter) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center rounded-md border ${isBar ? "floor-elem-bar border-[#ac9670] bg-[#eee5d4] text-[#294533]" : "floor-elem-counter border-[#75927c] bg-[#e0ebe1] text-[#294533]"}`}
      >
        <span className="truncate px-2 text-[10px] font-semibold tracking-[0.05em] text-inherit">
          {label || (isBar ? "BAR" : lang === "tr" ? "KASA" : "COUNTER")}
        </span>
        <span className="absolute inset-x-2 top-1 h-px bg-[#9dae9d]" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="floor-elem-label flex h-full w-full items-center justify-center rounded-md border border-[#a5b5a4] bg-[#f4f5ee] px-2 text-center text-[10px] font-semibold tracking-[0.04em] text-[#526c56]">
      <span className="truncate">{label || (lang === "tr" ? "ALAN" : "AREA")}</span>
    </div>
  );
}

export default function FloorElement({
  element,
  lang = "tr",
  selected = false,
  editable = false,
  dimensions,
  onPointerDown,
  onKeyDown,
  onSelect,
}) {
  const label = getFloorElementLabel(element, lang);
  const content = <ElementArtwork type={element.type} label={element.label} lang={lang} />;
  const sharedProps = {
    style: {
      left: `clamp(0px, ${Number(element.posX) || 0}%, calc(100% - ${dimensions.widthPx}px))`,
      top: `clamp(0px, ${Number(element.posY) || 0}%, calc(100% - ${dimensions.heightPx}px))`,
      width: `${dimensions.widthPx}px`,
      height: `${dimensions.heightPx}px`,
      transform: `rotate(${Number(element.rotation) || 0}deg)`,
    },
    className: `absolute z-[2] origin-center ${selected ? "rounded-md outline outline-2 outline-offset-2 outline-[#24543e]" : ""} ${editable ? "cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none"}`,
  };

  if (!editable) {
    return (
      <div {...sharedProps} role="img" aria-label={label}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      {...sharedProps}
      aria-label={`${label}, ${lang === "tr" ? "kroki öğesi" : "floor-plan element"}`}
      aria-pressed={selected}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}
