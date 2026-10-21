import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../lighting/deferred/shaders.ts'
import {
  COLOR_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  tileDeclarations,
} from '../../materials/virtual/wgsl.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL, VIS_UNIFORMS_WGSL } from '../shader/pageWgsl.ts'
import { PAGE_GEOMETRY_WGSL } from '../shader/pageGeometryWgsl.ts'
import { maskUvWgsl } from '../shader/pageUvSetWgsl.ts'
import { SMALL_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { RASTER_PIXEL_WGSL, pixelCount, pixelOffset } from './pixelWgsl.ts'
import { rasterKernels, rasterListWgsl } from './kernelsWgsl.ts'
import { visTriangle } from '../visWords.ts'
import { FLAT_INDEX_WGSL } from '../../gpu/dispatch/grid.ts'

/**
 * Software raster of the clusters the split hands it (`binWgsl.ts`), opaque and masked: it writes
 * the visibility buffer the hardware raster writes too — a depth key, then an identifier, a pixel —
 * by the same rule (`VIS_WRITE_WGSL`), and the full-screen resolves then copy it into the
 * attachments every consumer reads. Blend and transmission surfaces keep their pass.
 *
 * A mask material does its alpha test HERE, at the perspective-correct weights of the pixel,
 * its footprint the weights' screen steps: the colour sampler's own level and anisotropy path, at
 * the same threshold as the hardware raster's.
 */
export const rasterSource = (capacity: number) =>
  wgslProgram(
    `@group(0) @binding(${SMALL_BINDINGS.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${SMALL_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${SMALL_BINDINGS.uniform}) var<uniform> uni:Uniforms;
@group(0) @binding(${SMALL_BINDINGS.uvs}) var<storage,read> uvs:array<f32>;
${tileDeclarations(SMALL_BINDINGS.color, 'color')}
@group(0) @binding(${SMALL_BINDINGS.sampler}) var mapsSampler:sampler;
// One work buffer: first the visibility buffer — depth keys, then identifiers one screen
// further —, then each pass's two triangle lists, their counts, the dispatches they imply, then
// one row and one triangle per entry; the pipeline's pass names its lists (\`LIST\`).
@group(0) @binding(${SMALL_BINDINGS.work}) var<storage,read_write> work:array<atomic<u32>>;
${rasterKernels(capacity)}`,
    [
      PAGE_INFO_STRUCT_WGSL,
      VIS_UNIFORMS_WGSL,
      TILE_POOL_WGSL,
      COLOR_SAMPLE_WGSL,
      PAGE_GEOMETRY_WGSL,
      materialTableWgsl(SMALL_BINDINGS.material),
      maskUvWgsl(SMALL_BINDINGS.normals),
      RASTER_PIXEL_WGSL,
      rasterListWgsl(capacity),
      visTriangle,
      FLAT_INDEX_WGSL,
    ],
  )

/**
 * Full-screen resolves of the visibility buffer: a triangle that covers the screen rereads the
 * work buffer and writes every pixel into the attachments consumers read — identifiers as
 * `r32uint`, depth-buffer depth, linear depth of pyramid level zero —, the background's too, its
 * key the far plane's and its identifier zero.
 *
 * `depthLevel` serves between the two halves of the frame: the pyramid needs occluder depth
 * before any identifier is resolved, so it writes level zero alone. `resolved` closes the frame,
 * when depth is final and the identifier chosen.
 */
export const RESOLVE = wgslProgram(
  `@group(0) @binding(0) var<storage,read> frame:array<u32>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
struct Resolved{@location(0) id:u32,@location(1) hiz:f32,@builtin(frag_depth) depth:f32,}
@fragment fn resolved(@builtin(position) pos:vec4f)->Resolved{let i=pixelOffset(vec2u(pos.xy));let depth=bitcast<f32>(frame[i]);return Resolved(frame[pixelCount()+i],depth,depth);}
@fragment fn depthLevel(@builtin(position) pos:vec4f)->@location(0) f32{return bitcast<f32>(frame[pixelOffset(vec2u(pos.xy))]);}`,
  [VIS_UNIFORMS_WGSL, pixelCount, pixelOffset, FULLSCREEN_VERTEX],
)
