// Each display curve's inverse (`toneUnmap`), run as shipped: the display curve (`toneMap`) gives
// back the display value its inverse started from, to the byte, on every curve, from black to half
// a byte below white, over the colours every curve can show — ACES and AgX desaturate, and a colour
// past what they show comes back as the nearest radiance of no negative channel —: what a mirror
// needs to show a colour as the display shows it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { linearToSrgb, srgbToLinear } from '../../../math/src/color/color.ts'
import { TONE_MAPPING_WGSL, TONE_UNMAPPING_WGSL } from './toneMappingWgsl.ts'

type Curve = (c: number[]) => number[]
const run = shaderRun<{
  aces: Curve
  cineonCurve: Curve
  agxCurve: Curve
  neutralCurve: Curve
  toneUnmap: (y: number[], curve: number) => number[]
}>(
  wgslModule(TONE_MAPPING_WGSL, TONE_UNMAPPING_WGSL),
  [
    'toneUnmap',
    'aces',
    'cineonCurve',
    'agxCurve',
    'neutralCurve',
    'acesInverse',
    'cineonInverse',
    'agxInverse',
    'neutralInverse',
  ],
  {},
)

const R = TONE_MAPPING_RANK
const clip = (c: number[]) => c.map((x) => Math.min(Math.max(x, 0), 1))
/** The curves by rank, as `toneMap`'s switch picks them; its two one-line cases written here. */
const toneMap: Record<number, Curve> = {
  [R.none]: (c) => c,
  [R.linear]: clip,
  [R.reinhard]: (c) => clip(c.map((x) => x / (1 + x))),
  [R.cineon]: run.cineonCurve,
  [R.aces]: run.aces,
  [R.agx]: run.agxCurve,
  [R.neutral]: run.neutralCurve,
}

const bytes = [
  [0x17, 0x1d, 0x28],
  [0xcf, 0xd8, 0xe3],
  [128, 128, 128],
  [150, 120, 100],
  [40, 90, 200],
  [90, 150, 110],
  [254.5, 254.5, 254.5],
  [3, 3, 3],
  [0, 0, 0],
]

test('every display curve gives back what its inverse started from', () => {
  for (const [name, rank] of Object.entries(TONE_MAPPING_RANK))
    for (const colour of bytes) {
      const y = colour.map((b) => srgbToLinear(b / 255))
      const back = toneMap[rank](run.toneUnmap(y, rank))
      // In display bytes: the same byte, the one value the display shows.
      for (let c = 0; c < 3; c++)
        assert.ok(
          Math.abs(linearToSrgb(back[c]) * 255 - linearToSrgb(y[c]) * 255) < 0.5,
          `${name} ${colour}: ${back.map((v) => linearToSrgb(v) * 255)}`,
        )
    }
})
