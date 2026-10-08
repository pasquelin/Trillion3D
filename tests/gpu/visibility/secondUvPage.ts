// The engine side of the second-UV-set proof (`second-uv.gpu.ts`): the lobes proofs' plane
// (`physicalLobesPage.ts`) lit by two lamps, one each side, under a sharp clear coat whose map —
// coat on its right texel only, filtered nearest — reads the second UV set (`channel` 1). That
// set mirrors the first across the plane's middle, so read on it the coat covers the left half,
// read on the first the right one. The plane's geometry goes through the float pool (its second
// set at the tail of the normal atlas, `uv1Tail.ts`) or through quantized pages that store it
// (`compiledPages.ts`), drawn opaque or blended.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { runOnDevice as withDevice } from '../kit/deviceProof.ts'
import { level, MATTE, plane, type PlaneOptions } from './physicalLobesPage.ts'

/** Where each lamp's mirror highlight lands: the plane's point between the eye (z 3) and a lamp
 *  (x ±0.6, z 1.2), on the texel each side of a two-texel map. */
const HIGHLIGHT = (0.6 * 3) / (3 + 1.2)

/** The plane with its second UV set: the first mirrored in u. */
function mirrored() {
  const geometry = G.planeGeometry(2.4, 2.4)
  const uv = geometry.attributes.uv.array
  const second = Array.from(uv, (value, i) => (i % 2 ? value : 1 - value))
  geometry.setAttribute('uv1', G.floatAttribute(second, 2))
  return geometry
}

/** A sharp coat on the right texel of its map, read at UV set `channel`. */
function coated(channel: number): G.SurfaceParameters {
  const clearcoatMap = G.dataTexture(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1)
  Object.assign(clearcoatMap, { channel })
  return { ...MATTE, clearcoat: 1, clearcoatRoughness: 0.08, clearcoatMap }
}

/** The brightness each side, where a lamp's highlight lands. */
export type SideReading = { left: number; right: number }

/** Each case's held image read each side. */
export const secondUv = () =>
  withDevice<{ readings: Record<string, SideReading> }>(async (device, events, result) => {
    const lamps = createSceneLightStore()
    for (const x of [-0.6, 0.6])
      lamps.add({
        id: `lamp ${x}`,
        kind: 'point',
        position: [x, 0, 1.2],
        color: [1, 1, 1],
        intensity: 2,
        range: 20,
        castsShadow: false,
      })
    const cases: Record<string, [number, PlaneOptions]> = {
      first: [0, {}],
      floats: [1, {}],
      pages: [1, { compiled: true }],
      blendFloats: [1, { blend: true }],
      blendPages: [1, { blend: true, compiled: true }],
    }
    result.readings = {}
    for (const [name, [channel, options]] of Object.entries(cases)) {
      const pixels = await plane(device, events, coated(channel), {
        ...options,
        geometry: mirrored(),
        sceneLights: lamps,
      })
      result.readings[name] = {
        left: level(pixels, -HIGHLIGHT, 0),
        right: level(pixels, HIGHLIGHT, 0),
      }
    }
  })
