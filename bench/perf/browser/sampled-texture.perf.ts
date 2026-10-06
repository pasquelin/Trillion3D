// the bytes of a sampled texture.
import type { Texture } from '../../../packages/sdk-core/src/index.ts'
import { importHostTexture } from '../../../packages/sdk-browser/src/host/textureImport.ts'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { textureRgba } from '../../../packages/sdk-browser/src/visibility/types.ts'
import { xorshiftRandom, measure, stress, rapport } from '../../core/index.ts'
import { referenceTextureRgba } from '../../oracles/browser/sampled-texture.ts'

const alea = xorshiftRandom(3313)
const octets = (n: number) => {
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) data[i] = Math.floor(alea() * 256)
  return data
}
const texture = (width: number, height: number) => {
  const t = new G.GraphTexture()
  t.image = { data: octets(width * height * 4), width: width, height: height }
  return t
}
const grandeTexture = texture(512, 512),
  minuscule = texture(1, 1)
const withoutData = new G.GraphTexture()
withoutData.image = { width: 4, height: 4 }
const sansImage = new G.GraphTexture()
const zero = new G.GraphTexture()
zero.image = { data: new Uint8Array(0), width: 0, height: 0 }
const contentBefore = octets(16 * 16 * 4),
  contentAfter = octets(8 * 8 * 4)
const shiftedView = new Uint8Array(new ArrayBuffer(4096), 128, 1024)
const decalee = new G.GraphTexture()
decalee.image = { data: shiftedView, width: 16, height: 16 }

interface CasTexture {
  textures?: G.GraphTexture[]
  tours: number
  remplacer?: boolean
}

const passeTexture =
  (fn: (t: Texture) => { data: Uint8Array; width: number; height: number } | null) =>
  (input: CasTexture) => {
    const sum = new Float64Array(4)
    let nuls = 0
    const cibles = input.remplacer
      ? [
          (() => {
            const t = new G.GraphTexture()
            t.image = { data: contentBefore, width: 16, height: 16 }
            return t
          })(),
        ]
      : (input.textures ?? [])
    for (let tour = 0; tour < input.tours; tour++)
      for (const target of cibles) {
        if (input.remplacer && tour === 1)
          target.image = { data: contentAfter, width: 8, height: 8 }
        // The engine reads the imported record; the host object is what a bench may still mutate.
        const rgba = fn(importHostTexture(target))
        if (!rgba) {
          nuls++
          continue
        }
        const index = ((tour * 7) % Math.max(1, rgba.width * rgba.height)) * 4
        sum[0] += rgba.data[index] ?? -1
        sum[1] += rgba.width
        sum[2] += rgba.height
        sum[3] += rgba.data.byteLength
      }
    return { sum, nuls }
  }

const all = [grandeTexture, minuscule, decalee, withoutData, sansImage, zero]
const casTexture = [
  {
    name: '100 000 texel reads',
    input: { textures: [grandeTexture], tours: 100000 },
    size: 100000,
  },
  {
    name: 'edge cases: offset, no image, empty',
    input: { textures: all, tours: 10000 },
    size: all.length * 10000,
  },
  {
    name: 'texture replaced mid-way',
    input: { remplacer: true, tours: 4 },
    size: 4,
  },
]

const resTexture = await measure({
  name: 'textureRgba',
  fichier: 'packages/sdk-browser/src/visibility/types.ts',
  cas: casTexture,
  calculation: passeTexture(textureRgba),
  expected: passeTexture(referenceTextureRgba),
  options: { tours: 40, budgetMs: 1500 },
})

await stress({
  name: 'textureRgba extremes',
  calculation: (t: G.GraphTexture) => textureRgba(importHostTexture(t)),
  extremes: [
    { name: 'sansImage', input: sansImage },
    { name: 'zero', input: zero },
  ],
})

rapport('texture-echantillonnee', [resTexture], 'F15 yields the exact same bytes and dimensions')
