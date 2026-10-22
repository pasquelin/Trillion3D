import { PIXEL_TRIANGLE_WGSL, SHADE_UNI_WGSL } from './pixelTriangleWgsl.ts'
import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { COTANGENT_FRAME_WGSL } from '../../geometry/cluster/cotangentFrameWgsl.ts'
import { TRIANGLE_PALETTE_WGSL } from '../../diagnostic/trianglePalette.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from './pageWgsl.ts'
import { edgeFunction } from '../../../../math/src/wgsl/barycentric.ts'
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL, PAGE_SCREEN_WGSL } from './pageGeometryWgsl.ts'
import { PAGE_UV_SET_WGSL } from './pageUvSetWgsl.ts'
import { UV_GRADIENTS_WGSL } from './uvGradientsWgsl.ts'
import {
  COLOR_SAMPLE_WGSL,
  DATA_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  tileDeclarations,
} from '../../materials/virtual/wgsl.ts'
import { TILE_REQUEST_WGSL } from '../../materials/virtual/requestWgsl.ts'
import { SHADE_REQUEST_WGSL } from './request.ts'
import { SHADE_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { MATERIAL_CLASS_WGSL } from './materialClass.ts'
import { SHADE_OUTPUTS_WGSL } from './shadeOutputsWgsl.ts'
import { SURFACE_MODEL_SHADE_WGSL } from '../../materials/surface/surfaceModel.ts'
import { SHADING_POINT_WGSL } from './shadingPoint.ts'
import { shadeCacheReadWgsl } from './shadeCacheLayout.ts'
import { PHYSICAL_RESOLVE_WGSL } from './physicalWgsl.ts'

/**
 * Declarations of the surface resolve: its bindings — its outputs and its class's bin among them
 * (`shadeOutputsWgsl.ts`) —, the page reads, the atlas reads, the tile request and the class
 * overrides. `request` is the tile request the pixel makes: its surface's maps'
 * (`SHADE_REQUEST_WGSL`), or the textures' of its graph (`shadeGraphWgsl.ts`).
 */
export const shadeDeclWgsl = (request: WgslDecl = SHADE_REQUEST_WGSL) =>
  wgslBlock(
    request === SHADE_REQUEST_WGSL ? 'SHADE_DECL_WGSL' : `SHADE_DECL_WGSL(${request.name})`,
    [
      PAGE_GEOMETRY_WGSL,
      shadeCacheReadWgsl(SHADE_BINDINGS.shadeCache),
      PIXEL_TRIANGLE_WGSL,
      PHYSICAL_RESOLVE_WGSL,
      SHADE_OUTPUTS_WGSL,
      PAGE_INFO_STRUCT_WGSL,
      SHADING_POINT_WGSL,
      SHADE_UNI_WGSL,
      normalAtlasWgsl(SHADE_BINDINGS.normal),
      MATERIAL_CLASS_WGSL,
      TRIANGLE_PALETTE_WGSL,
      PAGE_SCREEN_WGSL,
      PAGE_NORMAL_WGSL,
      PAGE_UV_SET_WGSL,
      edgeFunction,
      UV_GRADIENTS_WGSL,
      TILE_POOL_WGSL,
      COLOR_SAMPLE_WGSL,
      DATA_SAMPLE_WGSL,
      TILE_REQUEST_WGSL,
      request,
      COTANGENT_FRAME_WGSL,
      SURFACE_MODEL_SHADE_WGSL,
    ],
    `@group(0) @binding(${SHADE_BINDINGS.visView}) var vis:texture_2d<u32>;
@group(0) @binding(${SHADE_BINDINGS.cache}) var<storage, read> indices:array<u32>;
@group(0) @binding(${SHADE_BINDINGS.position}) var<storage, read> positions:array<f32>;
@group(0) @binding(${SHADE_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
@group(0) @binding(${SHADE_BINDINGS.pageTable}) var<storage, read> pages:array<PageInfo>;
${tileDeclarations(SHADE_BINDINGS.color, 'color')}
@group(0) @binding(${SHADE_BINDINGS.sampler}) var mapsSampler:sampler;
@group(0) @binding(${SHADE_BINDINGS.uniform}) var<uniform> uni:ShadeUni;
${tileDeclarations(SHADE_BINDINGS.data, 'data')}
/** A surface with nothing to light and nothing to ask: a triangle index past its page. The
 *  cutout is the raster's alone (maskKeep), never tested again here. */
fn emptySurface()->SurfaceOut{return SurfaceOut(vec4f(0.0),vec4f(0.0),vec4f(0.0),0u,0u);}
/** A diagnostic keeps the request: its textures converge like those of the image. */
fn diagnosticSurface(color:vec3f,request:u32)->SurfaceOut{return SurfaceOut(vec4f(color,0.0),vec4f(0.0),vec4f(0.0),3u,request);}
/** A diagnostic pixel that draws nothing — the view's background shows —, its request kept. */
fn diagnosticEmpty(request:u32)->SurfaceOut{return SurfaceOut(vec4f(0.0),vec4f(0.0),vec4f(0.0),0u,request);}
`,
  )

/** The resolve's declarations of a class that reads its surface's maps. */
export const SHADE_DECL_WGSL = shadeDeclWgsl()
