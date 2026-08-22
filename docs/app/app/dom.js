/**
 * Building DOM without a framework, and without pretending to be one.
 *
 * ## Why this is nine lines instead of a dependency
 *
 * The whole reason `web/` has no bundler is that a school Chromebook on school wi-fi downloads what
 * it needs and nothing else, and a solo-maintained project with an empty supply chain cannot be
 * compromised on a Tuesday. Reaching for React here would undo that for the sake of a convenience
 * this file provides in a paragraph.
 *
 * What it is *not* is a rendering engine. There is no virtual DOM, no reconciliation and no
 * component lifecycle — screens are functions that return elements, and a route change replaces the
 * subtree. That is fast enough because the demo studio is five performers and three weeks, and it
 * is honest about what it does.
 */

/**
 * `el("div", {class: "card"}, "text", otherElement)`.
 *
 * Attributes are set with `setAttribute` so ARIA and `data-` work without special cases; the four
 * exceptions are the ones where the attribute and the property genuinely differ.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value; // only ever called with strings from this repo
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replaces everything inside `parent` with `nodes`. */
export function replace(parent, ...nodes) {
  parent.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  return parent;
}

/**
 * An SVG element. Separate from `el` because SVG lives in its own namespace and
 * `createElement("circle")` silently produces an unknown HTML element that renders nothing —
 * a bug with no error attached to it.
 */
export function svg(tag, props = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child) node.append(child);
  }
  return node;
}
