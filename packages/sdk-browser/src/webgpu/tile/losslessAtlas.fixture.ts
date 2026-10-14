import { createWebgpuTileAtlas } from './atlas.ts'
import { tileLayout } from '../../texture/tiles.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'

const empty = { levels: [], blocks: { bc7: [], astc: [], etc2: [] } }

/** One 4096² texture in one lossless layer — 900 places —, its tail pinned, read at `clock`. */
export function losslessAtlas(
  device: Parameters<typeof createWebgpuTileAtlas>[0],
  clock: () => number,
) {
  const atlas = createWebgpuTileAtlas(device, {
    kind: 'color',
    encoding: poolEncoding(undefined),
    layers: { lossless: 1, rgba: 0, 'two-channel': 0 },
    feedbackOffset: 0,
    textures: [
      { layout: tileLayout(4096, 4096), lane: 'lossless', source: { kind: 'bytes', tail: empty } },
    ],
    clock,
  })
  atlas.pinTails({ writeTexture() {} } as never, () => {})
  return atlas
}
