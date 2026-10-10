import { pyramidBytes } from './oracle.ts'
import { HIZ_CULL_FARTHEST, hizRoute } from './pyramidTexture.ts'

// The scene a pyramid build is transcribed over (`buildTranscripts.fixture.ts`): a depth texture, its
// layout in the packed pyramid, and the texel a pyramid reads of it.
export type Scene = {
  texture: Float32Array
  width: number
  height: number
  maxLevels: number
  /** The nearest layer's build (`HIZ_NEAREST_BUILD`): the maximum, level 0 not copied. */
  nearest?: boolean
}

export function layout(scene: Scene) {
  const packed = pyramidBytes(scene.width, scene.height)
  const { sizes, offsets, texels: words, first, upper } = packed
  /** The levels' indices in the culling layer's routing, as the passes name them. */
  const routed = offsets.map((offset, level) => hizRoute(offset, level, HIZ_CULL_FARTHEST, packed))
  return { sizes, offsets, routed, first, upper, words }
}

export const texel = (scene: Scene, x: number, y: number) => scene.texture[y * scene.width + x]
