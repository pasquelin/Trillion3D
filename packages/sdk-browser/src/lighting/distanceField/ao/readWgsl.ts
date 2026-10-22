import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import type { DistanceFieldOcclusionSettings } from '../../../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import { AO_DOWNSAMPLE } from './cones.ts'

/** The words of the read uniform (`DfaoRead`). */
export const DFAO_READ_WORDS = 8

/**
 * THE BENT NORMAL A LIT PIXEL READS (`dfaoBentNormal`): the occlusion's image, at the grid's resolution, read
 * for the pixel `pixel` (its centre, in the view's pixels) of scene depth `depthCm` (centimetres). The four
 * cells round the pixel's place in the grid are weighed by their bilinear share and by `1 / (|their depth − the
 * pixel's| + 0.0001)`, so that a surface keeps its own occlusion at an edge; the place is held to the view's
 * (`limits.xy`). The result fades to the pixel's own normal with distance, from the farthest pixel lit
 * (`limits.z`) back over the fade (`limits.w` the reciprocal of its length): `dfaoApplyBentNormal`. The program
 * declares the image at `texture` and the uniform at `params`, in group `group`; `extent.xy` is the scene
 * buffer's size and `extent.zw` the grid's.
 */
export const dfaoReadWgsl = (group: number, texture: number, params: number) =>
  wgslBlock(
    `dfaoReadWgsl(${group}, ${texture}, ${params})`,
    [],
    `struct DfaoRead{extent:vec4f,limits:vec4f,}
@group(${group}) @binding(${texture}) var dfaoBentImage:texture_2d<f32>;
@group(${group}) @binding(${params}) var<uniform> dfaoRead:DfaoRead;
struct DfaoUpsampled{bent:vec3f,fade:f32,}
fn dfaoImageCell(cell:vec2i)->vec4f{
 return textureLoad(dfaoBentImage,clamp(cell,vec2i(0),vec2i(dfaoRead.extent.zw)-vec2i(1)),0);
}
fn dfaoBentNormal(pixel:vec2f,depthCm:f32)->DfaoUpsampled{
 let uv=min(pixel/dfaoRead.extent.xy,dfaoRead.limits.xy);
 let low=dfaoRead.extent.zw;
 let origin=floor(uv*low-0.5);
 let share=uv*low-0.5-origin;
 let at=vec2i(origin);
 let v00=dfaoImageCell(at);
 let v10=dfaoImageCell(at+vec2i(1,0));
 let v01=dfaoImageCell(at+vec2i(0,1));
 let v11=dfaoImageCell(at+vec2i(1,1));
 let corners=vec4f((1.0-share.y)*(1.0-share.x),(1.0-share.y)*share.x,share.y*(1.0-share.x),share.y*share.x);
 let depths=1.0/(abs(vec4f(v00.w,v10.w,v01.w,v11.w)-vec4f(depthCm))+vec4f(0.0001));
 let weights=corners*depths;
 let bent=(weights.x*v00.xyz+weights.y*v10.xyz+weights.z*v01.xyz+weights.w*v11.xyz)/dot(weights,vec4f(1.0));
 return DfaoUpsampled(bent,saturate((dfaoRead.limits.z-depthCm)*dfaoRead.limits.w));
}
fn dfaoApplyBentNormal(u:DfaoUpsampled,normal:vec3f)->vec3f{return mix(normal,u.bent,u.fade);}`,
  )

/**
 * Writes the read uniform into `out` (`DFAO_READ_WORDS`): the scene buffer's size `extent` and the grid's (half,
 * rounded down), the largest place a read takes in the grid — the view's cells less half a cell and a margin of 0.01,
 * so that no neighbour is read from past the view — and the fade.
 */
export function writeDfaoRead(
  out: Float32Array,
  extent: readonly [number, number],
  view: readonly [number, number],
  settings: DistanceFieldOcclusionSettings,
) {
  const grid = [Math.floor(extent[0] / AO_DOWNSAMPLE), Math.floor(extent[1] / AO_DOWNSAMPLE)]
  const seen = [Math.floor(view[0] / AO_DOWNSAMPLE), Math.floor(view[1] / AO_DOWNSAMPLE)]
  const fade = 1 / ((1 - settings.viewFadeDistanceScale) * settings.maxViewDistance)
  out.set([extent[0], extent[1], grid[0], grid[1]], 0)
  out.set(
    [(seen[0] - 0.51) / grid[0], (seen[1] - 0.51) / grid[1], settings.maxViewDistance, fade],
    4,
  )
  return out
}
