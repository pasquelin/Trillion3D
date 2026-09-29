// The one-pixel model of the blend tests (#558): WebGPU's blend equation, factor by factor, and
// the witness's display value, three@0.174's ACES filmic fit then sRGB, kept independent of the
// engine's shader on purpose.
import assert from 'node:assert/strict';

export type Rgba = readonly [number, number, number, number];

/** A blend factor of WebGPU, applied to one channel `c` (3 is alpha). */
function factor(name: GPUBlendFactor, src: Rgba, dst: Rgba, c: number) {
  const table: Partial<Record<GPUBlendFactor, number>> = {
    zero: 0,
    one: 1,
    src: src[c],
    'one-minus-src': 1 - src[c],
    'src-alpha': src[3],
    'one-minus-src-alpha': 1 - src[3],
    dst: dst[c],
    'dst-alpha': dst[3],
  };
  const value = table[name];
  if (value === undefined) throw new Error(`factor ${name} is not modelled`);
  return value;
}

/** What `state` writes for `src` over `dst`. */
export function blend(state: GPUBlendState, src: Rgba, dst: Rgba): Rgba {
  const channel = (c: number) => {
    const part = c === 3 ? state.alpha : state.color;
    assert.equal(part.operation ?? 'add', 'add');
    return (
      src[c] * factor(part.srcFactor ?? 'one', src, dst, c) +
      dst[c] * factor(part.dstFactor ?? 'zero', src, dst, c)
    );
  };
  return [channel(0), channel(1), channel(2), channel(3)];
}

/** What `target` holds after `src` over `dst`: `dst` where its write mask is off. */
export const written = (target: GPUColorTargetState, src: Rgba, dst: Rgba) =>
  target.writeMask === 0 ? dst : blend(target.blend!, src, dst);

/** The witness's tone curve of a linear colour: three@0.174's ACES filmic fit, clamped. */
export function filmic([r, g, b]: readonly number[]): number[] {
  const c = [r, g, b].map((v) => v / 0.6);
  const into = [0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
  const out = [
    1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602,
  ];
  const times = (m: number[], v: number[]) =>
    [0, 1, 2].map((i) => m[i] * v[0] + m[3 + i] * v[1] + m[6 + i] * v[2]);
  const fit = times(into, c).map(
    (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081),
  );
  return times(out, fit).map((v) => Math.min(1, Math.max(0, v)));
}

/** The sRGB transfer of a linear colour. */
export const srgb = (rgb: readonly number[]) =>
  rgb.map((x) => (x < 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055));

/** The witness's display value of a linear colour: its tone curve, then sRGB. */
export const display = (rgb: readonly number[]) => srgb(filmic(rgb));

/** The display value of `colour`, opaque. */
export const shown = (colour: Rgba): Rgba => {
  const [r, g, b] = display(colour);
  return [r, g, b, 1];
};

/** `actual` within `within` of `expected`, channel by channel. */
export const close = (actual: number[], expected: number[], mode: string, within = 1e-6) =>
  actual.forEach((value, c) => assert.ok(Math.abs(value - expected[c]) < within, `${mode} ${c}`));
