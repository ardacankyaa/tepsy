function measureLayout() {
  const issues = [];
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  };
  const visible = (el) => {
    const r = box(el),
      s = getComputedStyle(el);
    return (
      r.width > 2 &&
      r.height > 2 &&
      s.visibility !== "hidden" &&
      s.display !== "none" &&
      !el.closest('svg,.sr-only,[aria-hidden="true"]')
    );
  };
  const overlaps = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  const label = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.innerText ||
      el.getAttribute("placeholder") ||
      el.id ||
      el.tagName
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 90);
  const add = (type, el, detail) =>
    issues.push({ type, label: label(el), className: el.getAttribute("class") || "", ...detail });
  if (document.documentElement.scrollWidth > innerWidth + 1)
    issues.push({
      type: "page-overflow",
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
    });
  for (const input of document.querySelectorAll("input:not([type=checkbox]):not([type=radio])")) {
    if (!visible(input)) continue;
    const wrapper = input.parentElement;
    const icon = wrapper.querySelector("svg.lucide-search");
    if (!icon) continue;
    const r = box(input),
      i = box(icon),
      s = getComputedStyle(input),
      textLeft = r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft);
    if (i.right > textLeft - 3 && i.left < textLeft + 1)
      add("search-icon-overlap", input, { textLeft, iconRight: i.right });
  }
  for (const el of document.querySelectorAll(
    "main button,main a,main input,main select,main textarea,dialog[open] button,dialog[open] a,dialog[open] input,dialog[open] select"
  )) {
    if (
      !visible(el) ||
      el.closest(".floorplan-viewport,.floorplan-stage,.service-plan-canvas,.service-plan-viewport")
    )
      continue;
    const r = box(el);
    for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor),
        a = box(ancestor);
      if (
        ["auto", "scroll"].includes(style.overflowX) &&
        ancestor.scrollWidth > ancestor.clientWidth + 2
      )
        break;
      if (
        ["hidden", "clip"].includes(style.overflowX) &&
        (r.left < a.left - 2 || r.right > a.right + 2)
      ) {
        add("clipped-control", el, {
          control: r,
          container: ancestor.getAttribute("class") || ancestor.tagName,
          containerBox: a,
        });
        break;
      }
    }
    if (!["BUTTON", "A"].includes(el.tagName)) continue;
    const icons = Array.from(el.querySelectorAll("svg"))
      .map(box)
      .filter((i) => i.width > 2 && i.height > 2);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode,
        parent = node.parentElement;
      if (
        !node.textContent.trim() ||
        !visible(parent) ||
        parent.closest("svg,.sr-only") ||
        getComputedStyle(parent).textOverflow === "ellipsis" ||
        parseInt(getComputedStyle(parent).webkitLineClamp) > 0
      )
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const text of range.getClientRects()) {
        if (text.width < 2 || text.height < 2) continue;
        if (
          text.left < r.left - 2 ||
          text.right > r.right + 2 ||
          text.top < r.top - 2 ||
          text.bottom > r.bottom + 2
        )
          add("button-text-overflow", el, {
            text: node.textContent.trim().slice(0, 60),
            control: r,
            textBox: { left: text.left, right: text.right, top: text.top, bottom: text.bottom },
          });
        if (icons.some((icon) => overlaps(icon, text)))
          add("button-icon-overlap", el, { text: node.textContent.trim().slice(0, 60) });
      }
    }
  }
  for (const line of document.querySelectorAll(".pos-item-line")) {
    const price = line.querySelector(".pos-item-line-total"),
      name = line.querySelector(".pos-item-description"),
      remove = line.querySelector(".pos-remove-item");
    if (
      price &&
      visible(price) &&
      ((name && overlaps(box(price), box(name))) || (remove && overlaps(box(price), box(remove))))
    )
      add("checkout-line-overlap", line, {});
  }
  for (const line of document.querySelectorAll(".service-draft-line")) {
    const price = line.querySelector(".service-line-price"),
      name = line.querySelector(".service-line-name"),
      controls = line.querySelector(".service-quantity-controls");
    if (
      price &&
      visible(price) &&
      ((name && overlaps(box(price), box(name))) ||
        (controls && overlaps(box(price), box(controls))))
    )
      add("cart-content-overlap", line, {});
  }
  return issues;
}

module.exports = { measureLayout };
