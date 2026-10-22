import { wgslBlock, wgslConst } from '../../../../math/src/wgsl/decl.ts'
import { BLUE_NOISE_VOLUME } from './blueNoiseSource.ts'
import { BLUE_NOISE_FORMAT } from './blueNoiseTextures.ts'

const { width, height, depth } = BLUE_NOISE_VOLUME

/** The frames' half period, the offset a pass takes its second read of a pixel's number at, so that the two are as far apart in time as the masks
 *  allow: half of the largest frame index, rounded down. */
export const BLUE_NOISE_HALF_PERIOD = (depth - 1) >> 1

/** The masks' sizes in pixels and frames. */
export const BLUE_NOISE_TILE = wgslConst(
  'BLUE_NOISE_TILE',
  [],
  `const BLUE_NOISE_TILE=vec3u(${width}u,${height}u,${depth}u);`,
)

/** The masks that wrap a pixel and a frame onto the mask. */
const BLUE_NOISE_WRAP = wgslConst(
  'BLUE_NOISE_WRAP',
  [],
  `const BLUE_NOISE_WRAP=vec3u(${width - 1}u,${height - 1}u,${depth - 1}u);`,
)

/**
 * The blue noise at the pixel `coord` and the frame `frame`: the scalar mask in [0, 1] (`blueNoiseScalar`) or the vector mask's two numbers
 * (`blueNoiseVec2`), read from the texture `blueNoiseMask` declared at (`group`, `binding`) — sampled, or with `loadOnly` a read-only storage
 * texture, which spends none of the sixteen sampled textures of the stage that reads it. The pixel and the frame are wrapped onto the
 * mask, and the texel read is `(x, frame · height + y)` of the texture the frames are stacked down, by `textureLoad`.
 */
export const blueNoiseWgsl = (group: number, binding: number, loadOnly = false) =>
  wgslBlock(
    `blueNoiseWgsl(${group}, ${binding}, ${loadOnly})`,
    [BLUE_NOISE_TILE, BLUE_NOISE_WRAP],
    `@group(${group}) @binding(${binding}) var blueNoiseMask:${loadOnly ? `texture_storage_2d<${BLUE_NOISE_FORMAT},read>` : 'texture_2d<f32>'};
fn blueNoiseTexel(coord:vec2u,frame:u32)->vec4f{
 let w=vec3u(coord,frame)&BLUE_NOISE_WRAP;
 return textureLoad(blueNoiseMask,vec2u(w.x,w.z*BLUE_NOISE_TILE.y+w.y)${loadOnly ? '' : ',0'});
}
fn blueNoiseScalar(coord:vec2u,frame:u32)->f32{return blueNoiseTexel(coord,frame).x;}
fn blueNoiseVec2(coord:vec2u,frame:u32)->vec2f{return blueNoiseTexel(coord,frame).yz;}`,
  )
