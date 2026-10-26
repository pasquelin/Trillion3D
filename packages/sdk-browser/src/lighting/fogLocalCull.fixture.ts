// The local fog volumes' culling by tile (`./fog/localCullWgsl.ts`), run as shipped (`shaderRun`): the
// lists of the tiles it writes from a block of the light buffer, and the depth pyramid of an image it reads.
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { f32Bits } from '../../../math/src/float/bits.ts'
import { hizLevelWords } from '../visibility/hiz/gpu/levelsUniform.ts'
import { pyramidBytes } from '../visibility/hiz/gpu/oracle.ts'
import { packHizPyramid } from '../visibility/hiz/gpu/oracle.fixture.ts'
import { LOCAL_CULL_PROGRAM, LOCAL_CULL_PYRAMID_PROGRAM } from './fog/localPrograms.ts'
import type { LocalFogTiling } from './fog/localTiling.ts'

/** The depth pyramid the program reads (`hizDepthWgsl`) of an image `width` × `height` pixels whose pixels left
 *  of `edge` show a wall at the depth `depth` (the device's, reversed: larger is nearer), the others the sky,
 *  depth 0: the names its reader is bound to — level 0 is the image itself, the coarser levels the culling
 *  layer's farthest depth of each cell, as the frame builds them. */
export function wallPyramid(depth: number, edge: number, [width, height]: number[]) {
  const image = Array.from({ length: height }, () =>
    Array.from({ length: width }, (_, x) => (x < edge ? Math.fround(depth) : 0)),
  )
  const packed = packHizPyramid(image)
  const layout = pyramidBytes(width, height)
  const words = hizLevelWords(layout.sizes, layout.offsets, layout)
  const hizDepth = {}
  return {
    hizDepth,
    hizPyramid: {},
    hizLevels: {
      level: Array.from({ length: 16 }, (_, k) => [...words.subarray(k * 4, k * 4 + 4)]),
      count: [...words.subarray(64)],
    },
    textureLoad: (texture: object, at: number[], slice: number) => [
      texture === hizDepth
        ? f32Bits(image[at[1]][at[0]])
        : f32Bits(packed.data[at[1] * 8192 + at[0] + (slice === 1 ? packed.first : 0)]),
    ],
  }
}

/**
 * What the culling pass writes for the block `slots`, tile after tile, row after row: each tile's list, the
 * numbers of the volumes it keeps in the order it keeps them — where `pyramid` (`wallPyramid`) is given, over
 * the depth pyramid it stands for, each volume's verdict found first, else by the tiles' frustums alone —,
 * and the lists' words themselves.
 */
export function culledLists(
  slots: number[][],
  tiling: LocalFogTiling,
  count: number,
  pyramid?: ReturnType<typeof wallPyramid>,
) {
  const words: number[] = new Array(tiling.words).fill(0)
  const run = shaderRun<{
    localCullTile: (tile: [number, number]) => void
    localCullVolume?: (i: number) => void
  }>(
    pyramid ? LOCAL_CULL_PYRAMID_PROGRAM : LOCAL_CULL_PROGRAM,
    pyramid ? ['localCullTile', 'localCullVolume'] : ['localCullTile'],
    { directLights: { localFog: slots }, localFogTiles: words, ...pyramid },
  )
  if (pyramid) for (let i = 0; i < count; i++) run.localCullVolume!(i)
  const lists: number[][] = []
  for (let y = 0; y < tiling.down; y++)
    for (let x = 0; x < tiling.across; x++) {
      run.localCullTile([x, y])
      const at = (y * tiling.across + x) * tiling.stride
      lists.push(
        Array.from(
          { length: words[at] },
          (_, k) => (words[at + 1 + (k >> 2)] >>> (8 * (k & 3))) & 255,
        ),
      )
    }
  return { lists, words }
}
