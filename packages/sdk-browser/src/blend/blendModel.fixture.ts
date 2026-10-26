// The one-pixel model of the blend tests: WebGPU's blend equation, factor by factor, and
// the display value of a colour, the engine's default curve then sRGB.
import assert from 'node:assert/strict'
import { linearToSrgb } from '../../../math/src/color/color.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { DISPLAY_VALUE_WGSL } from '../lighting/toneMappingWgsl.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'

export type Rgba = readonly [number, number, number, number]

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
  }
  const value = table[name]
  if (value === undefined) throw new Error(`factor ${name} is not modelled`)
  return value
}

/** What `state` writes for `src` over `dst`: `max` and `min` keep the larger or smaller, their
 *  factors one. */
export function blend(state: GPUBlendState, src: Rgba, dst: Rgba): Rgba {
  const channel = (c: number) => {
    const part = c === 3 ? state.alpha : state.color
    const operation = part.operation ?? 'add'
    if (operation === 'max') return Math.max(src[c], dst[c])
    if (operation === 'min') return Math.min(src[c], dst[c])
    assert.equal(operation, 'add')
    return (
      src[c] * factor(part.srcFactor ?? 'one', src, dst, c) +
      dst[c] * factor(part.dstFactor ?? 'zero', src, dst, c)
    )
  }
  return [channel(0), channel(1), channel(2), channel(3)]
}

/** What `target` holds after `src` over `dst`: `dst` where its write mask is off. */
export const written = (target: GPUColorTargetState, src: Rgba, dst: Rgba) =>
  target.writeMask === 0 ? dst : blend(target.blend!, src, dst)

/** The display chain the engine ships (`displayValue`), run as JavaScript: the default curve then the
 *  sRGB transfer; the curve's own numbers are pinned by `../lighting/toneTable.test.ts`. */
const chain = shaderRun<{ displayValue: (c: number[], curve: number) => number[] }>(
  wgslModule(DISPLAY_VALUE_WGSL),
  ['displayValue'],
  // The film curve reads a hue as an angle; the interpreter's built-ins hold no `atan2`.
  { atan2: Math.atan2 },
)

/** The sRGB transfer of a linear colour. */
export const srgb = (rgb: readonly number[]) => rgb.map(linearToSrgb)

/** The display value of a linear colour: the default curve, then sRGB. */
export const display = (rgb: readonly number[]) =>
  chain.displayValue([...rgb], TONE_MAPPING_RANK.filmic)

/** The display value of `colour`, opaque. */
export const shown = (colour: Rgba): Rgba => {
  const [r, g, b] = display(colour)
  return [r, g, b, 1]
}

/** `actual` within `within` of `expected`, channel by channel. */
export const close = (
  actual: readonly number[],
  expected: readonly number[],
  mode: string,
  within = 1e-6,
) => actual.forEach((value, c) => assert.ok(Math.abs(value - expected[c]) < within, `${mode} ${c}`))
