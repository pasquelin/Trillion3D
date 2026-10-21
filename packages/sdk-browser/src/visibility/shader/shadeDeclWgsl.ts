import { PIXEL_TRIANGLE_WGSL, SHADE_UNI_WGSL } from './pixelTriangleWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { COTANGENT_FRAME_WGSL } from '../../geometry/cluster/cotangentFrameWgsl.ts'
import { TRIANGLE_PALETTE_WGSL } from '../../diagnostic/trianglePalette.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from './pageWgsl.ts'
import { edgeFunction } from '../../../../math/src/wgsl/barycentric.ts'
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL, PAGE_SCREEN_WGSL } from './pageGeometryWgsl.ts'
import { PAGE_UV_SET_WGSL } from './pageUvSetWgsl.ts'
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
 * Screen gradients (per pixel in x, then y) of the perspective-correct coordinate at `p` in the
 * screen triangle `(s0,s1,s2)`, of vertex coordinates `uva..uvc` and clip `1/w` `iw`: the
 * derivatives a fragment reads, exact at the pixel. Zero for a degenerate triangle. The formula
 * of the resolve (`shadeWgsl.ts`); `uvDerivatives` (`../uvDerivatives.fixture.ts`) is its CPU mirror.
 */
export const UV_GRADIENTS_WGSL = wgslBlock(
  'UV_GRADIENTS_WGSL',
  [],
  `fn uvGradients(s0:vec2f,s1:vec2f,s2:vec2f,p:vec2f,uva:vec2f,uvb:vec2f,uvc:vec2f,iw:vec3f)->mat2x2f{
 let dxb=s1.x-s0.x;let dyb=s1.y-s0.y;let dxc=s2.x-s0.x;let dyc=s2.y-s0.y;let det=dxb*dyc-dxc*dyb;
 if(det==0.0){return mat2x2f(vec2f(0.0),vec2f(0.0));}
 let inv=1.0/det;let dsdx=dyc*inv;let dsdy=-dxc*inv;let dtdx=-dyb*inv;let dtdy=dxb*inv;
 let s=((p.x-s0.x)*dyc-(p.y-s0.y)*dxc)*inv;let t=((p.y-s0.y)*dxb-(p.x-s0.x)*dyb)*inv;let a0=1.0-s-t;
 let iw0=iw.x;let iw1=iw.y;let iw2=iw.z;
 let U=a0*uva*iw0+s*uvb*iw1+t*uvc*iw2;let W=a0*iw0+s*iw1+t*iw2;
 if(W==0.0){return mat2x2f(vec2f(0.0),vec2f(0.0));}
 let dUds=-uva*iw0+uvb*iw1;let dUdt=-uva*iw0+uvc*iw2;let dWds=-iw0+iw1;let dWdt=-iw0+iw2;
 let dUdx=dUds*dsdx+dUdt*dtdx;let dUdy=dUds*dsdy+dUdt*dtdy;let dWdx=dWds*dsdx+dWdt*dtdx;let dWdy=dWds*dsdy+dWdt*dtdy;
 return mat2x2f((dUdx*W-U*dWdx)/(W*W),(dUdy*W-U*dWdy)/(W*W));
}`,
)

/**
 * Declarations of the surface resolve: its bindings — its outputs and its class's bin among them
 * (`shadeOutputsWgsl.ts`) —, the page reads, the atlas reads, the tile request and the class
 * overrides.
 */
export const SHADE_DECL_WGSL = wgslBlock(
  'SHADE_DECL_WGSL',
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
    SHADE_REQUEST_WGSL,
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
