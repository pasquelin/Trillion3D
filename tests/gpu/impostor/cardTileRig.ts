// The card maps of the impostor proofs in the engine's tile pool (#1527): the colour atlas holds
// the fill then one colour and coverage map a colour, the data atlas the fill, a normal and depth map
// and an ORM map — the card records name them by slot (`CARD_MAPS`). Each map is a square chain of
// RGBA8 levels, level 0 first: its streamed tiles written as the streamer writes a decoded level's
// tile, gutter included, its tail pinned from its bytes.
import { previewLevelSize } from '../../../packages/sdk-core/src/index.ts'
import { createWebgpuTileAtlas } from '../../../packages/sdk-browser/src/webgpu/tile/atlas.ts'
import { cardTileEntries } from '../../../packages/sdk-browser/src/webgpu/tile/cardReads.ts'
import type { TileTexture } from '../../../packages/sdk-browser/src/webgpu/tile/tileTexture.ts'
import {
  cellOrigin,
  tileRegion,
  writeRgba,
} from '../../../packages/sdk-browser/src/webgpu/tile/write.ts'
import { poolEncoding } from '../../../packages/sdk-browser/src/texture/blockFormats.ts'
import { tileLayout, tilesAt } from '../../../packages/sdk-browser/src/texture/tiles.ts'

/** A square map: its side and its levels' RGBA8 texels, level 0 first. */
export type Chain = { side: number; levels: Uint8Array<ArrayBuffer>[] }

/** The slots a card of colour `k` names: its colour map, the normal and depth map, the ORM map. */
export const CARD_MAPS = (k: number) => [1 + k, 1, 2] as const

const blocks = { bc7: [], astc: [], etc2: [] }
const white = new Uint8Array([255, 255, 255, 255])

/** A texture of `chain`, laid out down to its last level, its tail its bytes. */
const textureOf = (chain: Chain): TileTexture => {
  const layout = tileLayout(chain.side, chain.side, chain.levels.length)
  return {
    layout,
    lane: 'lossless',
    source: { kind: 'bytes', tail: { levels: chain.levels.slice(layout.tail), blocks } },
  }
}

/** The texels of `region` of a `width`-wide level, rows packed. */
function crop(level: Uint8Array, width: number, region: ReturnType<typeof tileRegion>) {
  const out = new Uint8Array(region.width * region.height * 4)
  for (let y = 0; y < region.height; y++) {
    const from = ((region.sy + y) * width + region.sx) * 4
    out.set(level.subarray(from, from + region.width * 4), y * region.width * 4)
  }
  return out
}

/** The atlases holding `colours`, `normalDepth` and `orm`, every tile resident; the group over
 *  them in `layout`, the card pass's tile group. */
export function cardTileAtlases(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sampler: GPUSampler,
  maps: { colours: Chain[]; normalDepth: Chain; orm: Chain },
) {
  const fill: TileTexture = {
    layout: tileLayout(1, 1),
    lane: 'lossless',
    source: { kind: 'bytes', tail: { levels: [white], blocks } },
  }
  const atlas = (kind: 'color' | 'data', feedbackOffset: number, chains: Chain[]) => {
    const made = createWebgpuTileAtlas(device, {
      kind,
      encoding: poolEncoding(undefined),
      layers: { lossless: 1, rgba: 0, 'two-channel': 0 },
      feedbackOffset,
      textures: [fill, ...chains.map(textureOf)],
      clock: () => 0,
    })
    made.pinTails(device.queue, () => {})
    chains.forEach((chain, k) => {
      const slot = 1 + k,
        { tail } = made.textures[slot].layout
      for (let level = 0; level < tail; level++) {
        const [width, height] = previewLevelSize(chain.side, chain.side, level),
          [across, down] = tilesAt(chain.side, chain.side, level)
        for (let ty = 0; ty < down; ty++)
          for (let tx = 0; tx < across; tx++) {
            const place = made.place({ slot, level, tx, ty })!
            const region = tileRegion(width, height, tx, ty),
              [ox, oy] = cellOrigin(place)
            const texels = crop(chain.levels[level], width, region)
            const origin = [ox + region.dx, oy + region.dy, place.layer]
            writeRgba(
              device.queue,
              made.poolOf(slot).texture,
              origin,
              texels,
              region.width,
              region.height,
            )
          }
      }
    })
    made.flush(device)
    return made
  }
  const color = atlas('color', 0, maps.colours)
  const data = atlas('data', color.pages.entries, [maps.normalDepth, maps.orm])
  const group = device.createBindGroup({
    layout,
    entries: cardTileEntries({ color, data }, sampler),
  })
  return {
    group,
    destroy() {
      color.destroy()
      data.destroy()
    },
  }
}

/** A chain of `levels` levels from a `side`² level 0 whose texels are `texel(x, y)`, each next
 *  level the rounded mean of the four texels above it — any bytes do: both reads read the same. */
export function chainOf(
  side: number,
  levels: number,
  texel: (x: number, y: number) => readonly number[],
): Chain {
  const first = new Uint8Array(side * side * 4)
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) first.set(texel(x, y), (y * side + x) * 4)
  const chain = [first]
  for (let level = 1; level < levels; level++) {
    const above = chain[level - 1],
      wide = side >> (level - 1),
      half = side >> level,
      out = new Uint8Array(half * half * 4)
    for (let i = 0; i < out.length; i++) {
      const c = i & 3,
        x = (i >> 2) % half,
        y = Math.floor((i >> 2) / half)
      const at = (dx: number, dy: number) => above[((2 * y + dy) * wide + 2 * x + dx) * 4 + c]
      out[i] = Math.round((at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4)
    }
    chain.push(out)
  }
  return { side, levels: chain }
}
