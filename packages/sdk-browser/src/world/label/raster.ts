/** Label admission: 2048² RGBA pixels (16 MiB), plus at most one replacement while repainting. */
const MAX_SIDE = 2048;
/** Bound font shaping work before asking the browser; 16 Ki UTF-16 units per label. */
const MAX_TEXT = 16 * 1024;
const PADDING = 2;
type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function rasterLabel(text: string, font: string): Promise<Canvas>;
export function rasterLabel(
  text: string,
  font: string,
  current: () => boolean,
): Promise<Canvas | null>;
/** Rasterise complete lines so the browser preserves shaping, ligatures and Unicode fallback. */
export async function rasterLabel(
  text: string,
  font: string,
  current = () => true,
): Promise<Canvas | null> {
  if (typeof text !== 'string' || typeof font !== 'string' || !font.trim())
    throw new TypeError('A label needs text and a nonempty CSS font.');
  if (text.length > MAX_TEXT) throw new RangeError('Label text exceeds 16384 UTF-16 units.');
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (lines.length > MAX_SIDE) throw new RangeError('Label has too many lines.');
  // Font waiting allocates no canvas. Superseded edits and removed labels never rasterise.
  const fonts =
    typeof document !== 'undefined'
      ? document.fonts
      : (globalThis as typeof globalThis & { fonts?: Pick<FontFaceSet, 'load'> }).fonts;
  await fonts?.load(font, text);
  if (!current()) return null;
  const canvas: Canvas =
    typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
  const context = canvas.getContext('2d') as Context | null;
  if (!context) throw new Error('Canvas 2D is unavailable for text labels.');
  context.font = '1px serif';
  context.font = font;
  if (context.font === '1px serif') {
    context.font = '2px serif';
    context.font = font;
    if (context.font === '2px serif')
      throw new TypeError('The label font is not a supported CSS font.');
  }
  const resolvedFont = context.font;
  const fontMetrics = context.measureText('Mg');
  let ascent = fontMetrics.fontBoundingBoxAscent ?? fontMetrics.actualBoundingBoxAscent;
  let descent = fontMetrics.fontBoundingBoxDescent ?? fontMetrics.actualBoundingBoxDescent;
  let left = 0,
    right = 0;
  for (const line of lines) {
    const metrics = context.measureText(line);
    ascent = Math.max(ascent, metrics.actualBoundingBoxAscent);
    descent = Math.max(descent, metrics.actualBoundingBoxDescent);
    left = Math.max(left, metrics.actualBoundingBoxLeft);
    right = Math.max(right, metrics.width, metrics.actualBoundingBoxRight);
  }
  const lineHeight = Math.max(1, Math.ceil(ascent + descent));
  const width = Math.max(1, Math.ceil(left + right) + 2 * PADDING);
  const height = lineHeight * lines.length + 2 * PADDING;
  if (![width, height].every((size) => Number.isFinite(size) && size <= MAX_SIDE))
    throw new RangeError('Label pixels exceed the 2048-pixel side limit.');
  canvas.width = width;
  canvas.height = height;
  context.font = resolvedFont;
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.fillStyle = '#ffffff';
  lines.forEach((line, at) =>
    context.fillText(line, PADDING + left, PADDING + ascent + at * lineHeight),
  );
  return canvas;
}
