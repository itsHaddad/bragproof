// One way to describe a piece of the page, two ways to produce it: text for the built pages, DOM nodes in the
// browser. Text from a log only ever enters as a text child, which is escaped in one form and a text node in the
// other, so nothing in a log can become markup. Attributes that could run code cannot be made at all.

export interface El {
  tag: string;
  attrs: Record<string, string>;
  kids: (El | string)[];
}

const SVG_TAGS = new Set(["svg", "g", "path", "rect", "circle", "line", "polygon", "use", "symbol", "defs", "title"]);
const NAME = /^[a-z][a-z0-9-]*$/i;
const BANNED = /^(on|style$|srcdoc$|formaction$)/i;
const LINK_ATTRS = new Set(["href", "src", "action", "xlink:href"]);
const SAFE_LINK = /^(\/(?!\/)|#|https:\/\/github\.com\/)/;

export function h(tag: string, attrs: Record<string, string | number | boolean | undefined> = {}, ...kids: (El | string | false | undefined | (El | string)[])[]): El {
  if (!NAME.test(tag) || tag.toLowerCase() === "script" || tag.toLowerCase() === "iframe") throw new Error(`h: tag not allowed: ${tag}`);
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (!/^[a-z][a-z0-9:-]*$/i.test(key) || BANNED.test(key)) throw new Error(`h: attribute not allowed: ${key}`);
    if (LINK_ATTRS.has(key.toLowerCase()) && !SAFE_LINK.test(String(value))) throw new Error(`h: address not allowed in ${key}`);
    clean[key] = value === true ? "" : String(value);
  }
  return { tag, attrs: clean, kids: kids.flat().filter((k): k is El | string => k !== false && k !== undefined) };
}

const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const VOID = new Set(["input", "br", "hr", "meta", "link", "img"]);

export function toHtml(node: El | string): string {
  if (typeof node === "string") return esc(node);
  const attrs = Object.entries(node.attrs).map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${esc(v)}"`)).join("");
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${node.kids.map(toHtml).join("")}</${node.tag}>`;
}

export function toDom(node: El | string, doc: Document = document, inSvg = false): Node {
  if (typeof node === "string") return doc.createTextNode(node);
  const svg = inSvg || node.tag === "svg";
  const el = svg && SVG_TAGS.has(node.tag) ? doc.createElementNS("http://www.w3.org/2000/svg", node.tag) : doc.createElement(node.tag);
  for (const [k, v] of Object.entries(node.attrs)) el.setAttribute(k, v);
  for (const kid of node.kids) el.appendChild(toDom(kid, doc, svg));
  return el;
}
