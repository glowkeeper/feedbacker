/**
 * Read a pdf.js page into positioned characters and image boxes, the way
 * pdfminer (under pdfplumber) does, by walking the page's operator list.
 *
 * pdf.js's text layer (`getTextContent`) gives positions but no colour, and
 * merges or inserts spaces on its own terms. The operator list has everything
 * the parser needs: the fill colour, the text state and every glyph with its
 * advance width. Coordinates are converted to pdfplumber's convention: `top`
 * and `bottom` measured down from the top of the page.
 */

import { OPS, type PDFPageProxy } from "#pdfjs";

export type Rgb = [number, number, number];

export interface Char {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
  upright: boolean;
  colour: Rgb | null; // fill colour, 0..1
}

export interface ImageBox {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface PageContent {
  width: number;
  height: number;
  chars: Char[];
  images: ImageBox[];
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` applied first, then `n` (PDF row-vector convention). */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function toMatrix(args: ArrayLike<number>): Matrix {
  return [args[0], args[1], args[2], args[3], args[4], args[5]];
}

function parseColour(args: unknown[]): Rgb | null {
  const [first] = args;
  if (typeof first === "string" && /^#[0-9a-f]{6}$/i.test(first)) {
    const n = parseInt(first.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  if (args.length === 1 && typeof first === "number") return [first, first, first];
  if (args.length === 3 && args.every((a) => typeof a === "number")) {
    return args as Rgb;
  }
  return null; // patterns, shadings and anything unrecognised
}

interface State {
  ctm: Matrix;
  fill: Rgb | null;
  font: string | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
}

interface Glyph {
  unicode: string;
  width: number;
  isSpace: boolean;
}

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
]);

export async function readPage(page: PDFPageProxy): Promise<PageContent> {
  const [x0, y0, x1, y1] = page.view;
  const width = x1 - x0;
  const height = y1 - y0;
  const top = (y: number) => y1 - y;

  // Font descents, as pdfminer uses them for character boxes.
  const { styles } = await page.getTextContent();
  const descent = (font: string | null) => (font && styles[font]?.descent) || 0;
  const { fnArray, argsArray } = await page.getOperatorList({
    annotationMode: 0, // AnnotationMode.DISABLE: pdfplumber ignores annotation appearances
  });

  const chars: Char[] = [];
  const images: ImageBox[] = [];
  let s: State = {
    ctm: IDENTITY,
    fill: [0, 0, 0],
    font: null,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
  };
  const stack: State[] = [];
  let textMatrix: Matrix = IDENTITY;
  let x = 0;
  let y = 0;
  let lineX = 0;
  let lineY = 0;

  const moveText = (tx: number, ty: number) => {
    x = lineX += tx;
    y = lineY += ty;
  };

  const showText = (glyphs: (Glyph | number)[]) => {
    const m = multiply(textMatrix, s.ctm);
    const size = s.fontSize * Math.hypot(m[2], m[3]);
    const upright = Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] > 0 && m[3] > 0;
    const d = descent(s.font) * s.fontSize;
    for (const g of glyphs) {
      if (typeof g === "number") {
        x -= (g / 1000) * s.fontSize * s.hScale;
        continue;
      }
      const glyphWidth = (g.width / 1000) * s.fontSize * s.hScale;
      const [ax, ay] = apply(m, x, y + s.rise + d);
      const [bx, by] = apply(m, x + glyphWidth, y + s.rise + d + s.fontSize);
      if (g.unicode) {
        chars.push({
          text: g.unicode,
          x0: Math.min(ax, bx) - x0,
          x1: Math.max(ax, bx) - x0,
          top: top(Math.max(ay, by)),
          bottom: top(Math.min(ay, by)),
          size,
          upright,
          colour: s.fill,
        });
      }
      x += glyphWidth + (s.charSpacing + (g.isSpace ? s.wordSpacing : 0)) * s.hScale;
    }
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = (argsArray[i] ?? []) as any[];
    switch (fn) {
      case OPS.save:
        stack.push({ ...s });
        break;
      case OPS.restore:
        s = stack.pop() ?? s;
        break;
      case OPS.transform:
        s.ctm = multiply(toMatrix(args), s.ctm);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ...s });
        if (args[0]) s.ctm = multiply(toMatrix(args[0]), s.ctm);
        break;
      case OPS.paintFormXObjectEnd:
        s = stack.pop() ?? s;
        break;
      case OPS.setFillRGBColor:
      case OPS.setFillGray:
      case OPS.setFillColor:
      case OPS.setFillColorN:
      case OPS.setFillCMYKColor:
        s.fill = parseColour(args);
        break;
      case OPS.beginText:
        textMatrix = IDENTITY;
        x = y = lineX = lineY = 0;
        break;
      case OPS.setFont:
        s.font = args[0];
        s.fontSize = args[1];
        break;
      case OPS.setCharSpacing:
        s.charSpacing = args[0];
        break;
      case OPS.setWordSpacing:
        s.wordSpacing = args[0];
        break;
      case OPS.setHScale:
        s.hScale = args[0] / 100;
        break;
      case OPS.setLeading:
        s.leading = -args[0];
        break;
      case OPS.setTextRise:
        s.rise = args[0];
        break;
      case OPS.setTextMatrix:
        textMatrix = toMatrix(args[0] ?? args);
        x = y = lineX = lineY = 0;
        break;
      case OPS.moveText:
        moveText(args[0], args[1]);
        break;
      case OPS.setLeadingMoveText:
        s.leading = args[1];
        moveText(args[0], args[1]);
        break;
      case OPS.nextLine:
        moveText(0, s.leading);
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        showText(args[0]);
        break;
      case OPS.nextLineShowText:
        moveText(0, s.leading);
        showText(args[0]);
        break;
      case OPS.nextLineSetSpacingShowText:
        s.wordSpacing = args[0];
        s.charSpacing = args[1];
        moveText(0, s.leading);
        showText(args[2]);
        break;
      default:
        if (IMAGE_OPS.has(fn)) {
          // An image fills the unit square under the current transform.
          const corners = [apply(s.ctm, 0, 0), apply(s.ctm, 1, 0), apply(s.ctm, 0, 1), apply(s.ctm, 1, 1)];
          const xs = corners.map(([cx]) => cx);
          const ys = corners.map(([, cy]) => cy);
          images.push({
            x0: Math.min(...xs) - x0,
            x1: Math.max(...xs) - x0,
            top: top(Math.max(...ys)),
            bottom: top(Math.min(...ys)),
          });
        }
    }
  }
  return { width, height, chars, images };
}
