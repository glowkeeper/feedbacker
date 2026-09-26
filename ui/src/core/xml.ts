/**
 * A small, namespace-aware XML tree for reading Office documents, built with
 * saxes (no DOM needed, so it runs in the core). Elements are matched by
 * namespace URI and local name, never by prefix, since a document may bind
 * any prefix to a namespace.
 */

import { SaxesParser } from "saxes";

export interface XmlElement {
  ns: string;
  local: string;
  /** Attributes keyed by "{namespace}local" (or just "local" when unqualified). */
  attrs: Map<string, string>;
  children: (XmlElement | string)[];
}

export class XmlError extends Error {}

export function parseXml(text: string): XmlElement {
  const parser = new SaxesParser({ xmlns: true });
  const root: XmlElement = { ns: "", local: "#document", attrs: new Map(), children: [] };
  const stack: XmlElement[] = [root];
  parser.on("opentag", (tag) => {
    const attrs = new Map<string, string>();
    for (const a of Object.values(tag.attributes)) attrs.set(a.uri ? `{${a.uri}}${a.local}` : a.local, a.value);
    const element: XmlElement = { ns: tag.uri ?? "", local: tag.local ?? tag.name, attrs, children: [] };
    stack.at(-1)!.children.push(element);
    stack.push(element);
  });
  parser.on("closetag", () => void stack.pop());
  parser.on("text", (t) => void stack.at(-1)!.children.push(t));
  parser.on("cdata", (t) => void stack.at(-1)!.children.push(t));
  try {
    parser.write(text).close();
  } catch {
    throw new XmlError("the XML is not well formed");
  }
  const document = root.children.find((c): c is XmlElement => typeof c !== "string");
  if (!document) throw new XmlError("the XML has no root element");
  return document;
}

export const elements = (e: XmlElement) => e.children.filter((c): c is XmlElement => typeof c !== "string");

/** Direct children with this namespace and local name. */
export const childrenOf = (e: XmlElement, ns: string, local: string) =>
  elements(e).filter((c) => c.ns === ns && c.local === local);

export const childOf = (e: XmlElement, ns: string, local: string) => childrenOf(e, ns, local)[0] ?? null;

/** Every descendant (depth-first, document order) with this namespace and local name. */
export function descendants(e: XmlElement, ns: string, local: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (el: XmlElement) => {
    for (const c of elements(el)) {
      if (c.ns === ns && c.local === local) out.push(c);
      walk(c);
    }
  };
  walk(e);
  return out;
}

export const attr = (e: XmlElement, ns: string, local: string) => e.attrs.get(`{${ns}}${local}`) ?? null;

/** All text directly inside this element (not its children's). */
export const ownText = (e: XmlElement) => e.children.filter((c): c is string => typeof c === "string").join("");
