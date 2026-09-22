import { hslToLinearRgb, linearToSrgb, srgbToLinear } from '../../mathColor.ts';
import { Observed } from './observed.ts';
import { namedColor } from './colorNames.ts';
import { clearValueOf, rgbHex } from './packedColour.ts';

/** What a colour can be written from: 0xRRGGBB, a CSS string, a colour, or linear `[r, g, b]`. */
export type ColorInput =
  number | string | { r: number; g: number; b: number } | readonly [number, number, number];

const hsl = new Float64Array(3);

/**
 * A colour in the linear working space the engine lights in. A hexadecimal or CSS value is sRGB
 * and is decoded on the way in, then encoded again by `getHex`; `r`, `g`, `b` and an array are
 * linear as they stand.
 */
export class Color extends Observed {
  readonly isColor = true as const;
  r = 1;
  g = 1;
  b = 1;

  constructor(value?: ColorInput) {
    super();
    if (value !== undefined) this.set(value);
  }
  set(value: ColorInput): this {
    if (typeof value === 'number') return this.setHex(value);
    if (typeof value === 'string') return this.setStyle(value);
    if (Array.isArray(value)) return this.setRGB(value[0], value[1], value[2]);
    const c = value as { r: number; g: number; b: number };
    return this.setRGB(c.r, c.g, c.b);
  }
  setRGB(r: number, g: number, b: number) {
    this.r = r;
    this.g = g;
    this.b = b;
    return this._changed();
  }
  setScalar(v: number) {
    return this.setRGB(v, v, v);
  }
  /** 0xRRGGBB, sRGB-encoded. */
  setHex(hex: number) {
    const { r, g, b } = clearValueOf(Math.floor(hex));
    return this.setRGB(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  }
  /** Hue, saturation, lightness in `[0, 1]`, sRGB-encoded. */
  setHSL(h: number, s: number, l: number) {
    hslToLinearRgb(hsl, 0, h, s, l);
    return this.setRGB(srgbToLinear(hsl[0]), srgbToLinear(hsl[1]), srgbToLinear(hsl[2]));
  }
  /** `#rgb`, `#rrggbb`, `rgb()`, `hsl()` or a CSS colour name. */
  setStyle(style: string): this {
    const text = style.trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (hex) {
      const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
      return this.setHex(parseInt(digits, 16));
    }
    const fn = /^(rgba?|hsla?)\(([^)]*)\)$/i.exec(text);
    if (fn) {
      const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
      const read = (i: number, scale: number) =>
        parts[i].endsWith('%') ? parseFloat(parts[i]) / 100 : parseFloat(parts[i]) / scale;
      if (fn[1].toLowerCase().startsWith('rgb'))
        return this.setRGB(
          srgbToLinear(read(0, 255)),
          srgbToLinear(read(1, 255)),
          srgbToLinear(read(2, 255)),
        );
      return this.setHSL(parseFloat(parts[0]) / 360, read(1, 100), read(2, 100));
    }
    const named = namedColor(text);
    if (named === undefined) throw new Error(`Unknown colour: ${style}`);
    return this.setHex(named);
  }
  copy(c: { r: number; g: number; b: number }) {
    return this.setRGB(c.r, c.g, c.b);
  }
  clone() {
    return new Color().copy(this);
  }
  /** 0xRRGGBB, sRGB-encoded and rounded to bytes. */
  getHex() {
    const byte = (v: number) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
    return (byte(this.r) << 16) | (byte(this.g) << 8) | byte(this.b);
  }
  getHexString() {
    return this.getStyle().slice(1);
  }
  getStyle() {
    const hex = this.getHex();
    return rgbHex((hex >> 16) & 255, (hex >> 8) & 255, hex & 255);
  }
  lerp(c: { r: number; g: number; b: number }, t: number) {
    return this.setRGB(
      this.r + (c.r - this.r) * t,
      this.g + (c.g - this.g) * t,
      this.b + (c.b - this.b) * t,
    );
  }
  multiplyScalar(s: number) {
    return this.setRGB(this.r * s, this.g * s, this.b * s);
  }
  equals(c: { r: number; g: number; b: number }) {
    return this.r === c.r && this.g === c.g && this.b === c.b;
  }
  fromArray(array: ArrayLike<number>, offset = 0) {
    return this.setRGB(array[offset], array[offset + 1], array[offset + 2]);
  }
  toArray(): [number, number, number] {
    return [this.r, this.g, this.b];
  }
}
