import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { fieldLayout, putVec4 } from '../../../gpu/core/fieldLayout.ts'
import type { CloudShown } from './viewTargets.ts'

/**
 * THE CLOUDS AS THE TRANSLUCENT SURFACES READ THEM: for a surface whose material has `cloudFog`, the
 * cloud image laid over its fog, so that a translucent surface behind a cloud shows through it
 * (`cloudFogOver`). The vertex stage reads the image (`CloudShown`, left by the image of the clouds):
 * its colour (the cloud's luminance, pre-exposed, and its transmittance) at the vertex's place on the
 * screen, and the least of the four front depths (kilometres) a gather there would read — the
 * trails a bilinear depth leaves are not cloud. A vertex whose distance from the eye is past that
 * front by `soft` kilometres or more is under the cloud in full; before, the cloud fades in over
 * them. The result is the layer to lay over the fog of the vertex: its light premultiplied, then the
 * transmittance, `(0, 0, 0, 1)` where the surface is before the cloud, wears no `cloudFog`, or no
 * image was made this image. The fragment stage has no room for the image (its sampled textures and
 * storage buffers are all spent), so the layer travels in an extra of the vertex stage's output
 * (`cloudVertexText.ts`) and is interpolated.
 *
 * The block holds, in `uv`, the scale from the view's screen coordinates to the image's and the
 * most it is read at, and in `soft`: the soft blending's length (`x`, kilometres), the reciprocal of
 * the pre-exposure the image's light was written with (`y`, what takes it back to the light the
 * blended pass multiplies by its own), and 1 (`z`) while the image is bound, else 0.
 */
export const CLOUD_FOG_BLOCK = fieldLayout('CloudFogBlock', [
  ['uv', 'vec4f'],
  ['soft', 'vec4f'],
] as const)

/** Where a program binds the cloud image the translucent surfaces read: in group `group`, the
 *  block, the colour and the depth images and the sampler the colour is read through. */
export interface CloudFogBindings {
  readonly group: number
  readonly block: number
  readonly colour: number
  readonly depth: number
  readonly sampler: number
}

/** What a program that reads the cloud image binds: the block, the two images and the sampler. */
export interface CloudFogSet {
  readonly block: GPUBuffer
  readonly colour: GPUTextureView
  readonly depth: GPUTextureView
  readonly sampler: GPUSampler
}

/** The layout entries of `cloudFogReadWgsl`'s bindings, seen by `visibility`: the depth is read by
 *  load alone, whatever it is stored in. */
export const cloudFogLayoutEntries = (
  b: CloudFogBindings,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(b.block, {}, visibility),
  computeTextureEntry(b.colour, 'float', '2d', visibility),
  computeTextureEntry(b.depth, 'unfilterable-float', '2d', visibility),
  computeSamplerEntry(b.sampler, 'filtering', visibility),
]

/** The block into `out` (`CLOUD_FOG_BLOCK.words` floats) for the image `shown`, or the block of no
 *  image (`undefined`: the layer is clear everywhere). */
export function writeCloudFogBlock(out: Float32Array<ArrayBuffer>, shown: CloudShown | undefined) {
  const { at } = CLOUD_FOG_BLOCK
  out.fill(0)
  if (!shown) return out
  putVec4(out, at.uv, shown.uvScale[0], shown.uvScale[1], shown.uvMax[0], shown.uvMax[1])
  putVec4(out, at.soft, shown.softBlendingKm, 1 / shown.preExposure, 1, 0)
  return out
}

/**
 * The vertex stage's read of the cloud image: `cloudFogOver(clip, P, eye)`, the layer to lay
 * over the fog of a vertex at clip position `clip` and scene point `P` seen from `eye`; the caller asks it
 * for a surface whose material has `cloudFog` alone.
 */
export const cloudFogReadWgsl = (b: CloudFogBindings) =>
  wgslBlock(
    `cloudFogReadWgsl(${b.group}, ${b.block}, ${b.colour}, ${b.depth}, ${b.sampler})`,
    [],
    `${CLOUD_FOG_BLOCK.wgsl}
@group(${b.group}) @binding(${b.block}) var<uniform> cloudFog:CloudFogBlock;
@group(${b.group}) @binding(${b.colour}) var cloudFogColour:texture_2d<f32>;
@group(${b.group}) @binding(${b.depth}) var cloudFogDepth:texture_2d<f32>;
@group(${b.group}) @binding(${b.sampler}) var cloudFogSampler:sampler;
fn cloudFogOver(clip:vec4f,P:vec3f,eye:vec3f)->vec4f{
 let none=vec4f(0.0,0.0,0.0,1.0);
 if(cloudFog.soft.z==0.0||clip.w<=0.0){return none;}
 let uv=min((clip.xy/clip.w*vec2f(0.5,-0.5)+0.5)*cloudFog.uv.xy,cloudFog.uv.zw);
 let size=vec2f(textureDimensions(cloudFogDepth));
 let corner=vec2i(floor(uv*size-0.5));
 let last=vec2i(size)-vec2i(1);
 var front=1e30;
 for(var k=0u;k<4u;k++){
  let at=clamp(corner+vec2i(i32(k&1u),i32(k>>1u)),vec2i(0),last);
  front=min(front,textureLoad(cloudFogDepth,at,0).x);
 }
 let inside=length(P-eye)*0.001-front;
 if(inside<=0.0){return none;}
 let cloud=textureSampleLevel(cloudFogColour,cloudFogSampler,uv,0.0);
 let layer=vec4f(cloud.rgb*cloudFog.soft.y,cloud.a);
 return mix(none,layer,saturate(inside/cloudFog.soft.x));
}`,
  )
