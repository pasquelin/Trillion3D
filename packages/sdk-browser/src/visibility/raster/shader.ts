import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
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
import { rasterPixelWgsl, visWorkDeclaration } from './pixelWgsl.ts'
import { NO_MASKS, type MaskSet } from '../../materials/graph/maskProgram.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { wpoGraphWgsl } from '../shader/wpoGraphWgsl.ts'
import { clusterKernels } from './clusterWgsl.ts'
import { RASTER_PAGE_TRANSFORM_WGSL } from './triWgsl.ts'
import { visTriangle } from '../visWords.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'

/**
 * Software raster of the clusters the bins list for it (`../bins/binsWgsl.ts`), opaque and masked: it writes
 * the visibility buffer the hardware raster writes too by the same rule (`visWriteWgsl`) — with
 * the 64-bit atomic maximum (`wide`) a pair a pixel, without it a depth key then an identifier —,
 * and the export then turns it into the attachments every consumer reads (`exportWgsl.ts`). Blend
 * and transmission surfaces keep their pass.
 *
 * A mask material does its alpha test HERE, at the perspective-correct weights of the pixel,
 * its footprint the weights' screen steps: the colour sampler's own level and anisotropy path, at
 * the same threshold as the hardware raster's. A surface whose graph wires an `opacityMask` is cut
 * by the graph, as the hardware raster cuts it (`masks`), and its triangles are set up on the vertices
 * its surface's offsets move (`wpo`). `subgroups` is the device's subgroup operations, which the
 * lanes of a group vote the way they raster a triangle by (`clusterKernels`).
 */
export const rasterSource = (
  masks: MaskSet = NO_MASKS,
  wpo: WpoSet = NO_WPO,
  wide = false,
  subgroups = false,
) =>
  wgslProgram(
    `@group(0) @binding(${SMALL_BINDINGS.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${SMALL_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${SMALL_BINDINGS.uniform}) var<uniform> uni:Uniforms;
@group(0) @binding(${SMALL_BINDINGS.uvs}) var<storage,read> uvs:array<f32>;
${tileDeclarations(SMALL_BINDINGS.color, 'color')}
@group(0) @binding(${SMALL_BINDINGS.sampler}) var mapsSampler:sampler;
// The visibility buffer: a depth key and an identifier a pixel, in one 64-bit word or in two planes.
${visWorkDeclaration(wide, SMALL_BINDINGS.work)}
// The pass's list of clusters (\`../bins/binsWgsl.ts\`), the pipeline's pass naming its header (\`LIST\`).
@group(0) @binding(${SMALL_BINDINGS.lists}) var<storage,read> lists:array<u32>;
override LIST:u32;
${clusterKernels(subgroups)}`,
    [
      PAGE_INFO_STRUCT_WGSL,
      VIS_UNIFORMS_WGSL,
      TILE_POOL_WGSL,
      COLOR_SAMPLE_WGSL,
      PAGE_GEOMETRY_WGSL,
      materialTableWgsl(SMALL_BINDINGS.material),
      maskUvWgsl(SMALL_BINDINGS.normals),
      rasterPixelWgsl(masks, wide),
      RASTER_PAGE_TRANSFORM_WGSL,
      visTriangle,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      ...(wpo.programs.length ? [wpoGraphWgsl(wpo)] : []),
    ],
  )
