import { pyramidBytes } from './oracle.ts'

// The scene a pyramid build is transcribed over (`buildTranscripts.fixture.ts`): a depth texture, its
// layout in the packed pyramid, and the texel a pyramid reads of it.
export type Scene = {
  texture: Float32Array
  textureWidth: number
  width: number
  height: number
  maxLevels: number
  /** One origin per pyramid, or none: the camera's single pyramid from texel zero. */
  origins?: Array<[number, number]>
  /** The nearest layer's build (`HIZ_NEAREST_BUILD`): the maximum, level 0 not copied. */
  nearest?: boolean
}

export function layout(scene: Scene) {
  const { sizes, offsets, texels: words } = pyramidBytes(scene.width, scene.height)
  const count = scene.origins?.length ?? 1
  const stride = scene.origins ? words : 0
  return { sizes, offsets, count, stride, words: words * count }
}

export const texel = (scene: Scene, z: number, x: number, y: number) => {
  const [ox, oy] = scene.origins ? scene.origins[z] : [0, 0]
  return scene.texture[(oy + y) * scene.textureWidth + ox + x]
}
