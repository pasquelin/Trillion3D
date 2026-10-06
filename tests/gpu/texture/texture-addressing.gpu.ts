// Texture addressing on the GPU (defects 4, 7, 8): the engine's wrap WGSL (`visibility/wrapModes.ts`)
// reads, on a real texture of distinct texels, what the native sampler set to the map's mode reads
// (`addressingTaps.ts`) — nearest, the texel it keeps; linear, the same blend bit for bit. On a
// period seam the engine blends the image's two edges itself: it cannot recover bit for bit the
// weight the sampler quantises, so there it must give the rule's exact colour to half a level in
// 255. A nearest read on an exact boundary depends on the 32-bit rounding of u·size: not held.
//
//   node bench/dawn/proofs.ts tests/gpu/texture/texture-addressing.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { importHostTexture } from '../../../packages/sdk-browser/src/host/textureImport.ts'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { wrapNibble } from '../../../packages/sdk-browser/src/visibility/wrapModes.ts'
import {
  ADDRESS_MODE,
  SIZES,
  TOLERANCE,
  addressingCases,
  onSeam,
  ruleColour,
  textureBytes,
  type AddressingCase,
} from './addressingCases.ts'
import { MAPS, TEXTURE, UV, mixedNibbles } from './addressingMaps.ts'
import { BLEND_BIT, sampleOnDawn, type TapBatch } from './addressingTaps.ts'

/** Gaps found, the first few kept as the failure's examples. */
function gaps() {
  const found: string[] = []
  return {
    add: (gap: string) => found.push(gap),
    assertNone(what: string) {
      assert.equal(
        found.length,
        0,
        `${found.length} ${what}, e.g.\n${found.slice(0, 5).join('\n')}`,
      )
    },
  }
}

test('the engine reads, nearest and linear, what the sampler set to the map mode reads', async () => {
  const cases = addressingCases()
  const textures = SIZES.map(([width, height]) => ({
    width,
    height,
    bytes: textureBytes(width, height),
  }))
  /** A case's addressing nibble, by the function the page records store (`wrapNibble`). */
  const nibble = ({ wrapS, wrapT }: AddressingCase) =>
    wrapNibble(importHostTexture(Object.assign(new G.GraphTexture(), { wrapS, wrapT })))
  const batches: (TapBatch & { members: AddressingCase[] })[] = []
  for (const filter of ['nearest', 'linear'] as const)
    SIZES.forEach(([width, height], texture) => {
      for (const [wrapS, addressS] of ADDRESS_MODE)
        for (const [wrapT, addressT] of ADDRESS_MODE) {
          const members = cases.filter(
            (c) =>
              c.width === width && c.height === height && c.wrapS === wrapS && c.wrapT === wrapT,
          )
          const flags = members.map((c) => nibble(c) | (filter === 'linear' ? BLEND_BIT : 0))
          const uv = members.flatMap((c) => [c.u, c.v])
          batches.push({ filter, texture, addressS, addressT, uv, flags, members })
        }
    })
  const reads = await sampleOnDawn(textures, batches)
  const nearest = gaps(),
    linear = gaps(),
    rule = gaps()
  batches.forEach(({ filter, members }, b) => {
    const { engine, sampler } = reads[b]
    members.forEach((c, i) => {
      const name = `${c.width}x${c.height} S=${c.nameS} T=${c.nameT} uv=(${c.u}, ${c.v})`
      if (filter === 'nearest') {
        const texel = [0, 1].map((j) => Math.round((engine[i * 4 + j] * 255 - 20) / 40))
        if (!c.boundary && texel.some((value, j) => value !== c.expected[j]))
          nearest.add(`${name}: texel ${texel}, rule ${c.expected}`)
        return
      }
      for (let k = 0; k < 2; k++) {
        const [t, size, wrap] = k ? [c.v, c.height, c.wrapT] : [c.u, c.width, c.wrapS]
        const read = engine[i * 4 + k]
        if (!onSeam(t, size, wrap) && !Object.is(read, sampler[i * 4 + k]))
          linear.add(`${name}: engine ${read * 255}, sampler ${sampler[i * 4 + k] * 255}`)
        const exact = ruleColour(t, size, wrap)
        if (Math.abs(read - exact) * 255 > TOLERANCE)
          rule.add(`${name}: ${read * 255}, rule ${exact * 255}`)
      }
    })
  })
  nearest.assertNone('nearest reads off a boundary leave the rule')
  linear.assertNone('linear reads off a seam differ from the sampler')
  rule.assertNone(`linear reads leave the exact rule by more than ${TOLERANCE}/255`)
})

test('each map of a mixed material folds its coordinate by its own nibble', async () => {
  const nibbles = mixedNibbles()
  const batches = MAPS.map(({ wrapS, wrapT }, rank) => ({
    filter: 'linear' as const,
    texture: 0,
    addressS: ADDRESS_MODE.get(wrapS)!,
    addressT: ADDRESS_MODE.get(wrapT)!,
    uv: UV.flat(),
    flags: UV.map(() => nibbles[rank] | BLEND_BIT),
  }))
  const reads = await sampleOnDawn([TEXTURE], batches)
  const found = gaps()
  let seams = 0
  MAPS.forEach(({ name, wrapS, wrapT }, rank) => {
    const { engine, sampler } = reads[rank]
    UV.forEach((uv, i) => {
      for (let k = 0; k < 2; k++) {
        const wrap = k ? wrapT : wrapS,
          size = k ? TEXTURE.height : TEXTURE.width
        const read = engine[i * 4 + k]
        if (!onSeam(uv[k], size, wrap)) {
          if (!Object.is(read, sampler[i * 4 + k]))
            found.add(
              `${name} uv=(${uv}) ${k}: engine ${read * 255}, map ${sampler[i * 4 + k] * 255}`,
            )
          continue
        }
        seams++
        const exact = ruleColour(uv[k], size, wrap)
        if (Math.abs(read - exact) * 255 > TOLERANCE)
          found.add(`${name} uv=(${uv}) ${k}: engine ${read * 255}, rule ${exact * 255}`)
      }
    })
  })
  assert.ok(seams > 0, 'no component read on a period seam')
  found.assertNone('reads leave their map mode')
})
