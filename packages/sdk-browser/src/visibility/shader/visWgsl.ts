import { PAGE_BINDING, PAGE_INFO_WGSL, PAGE_LOOKUP_WGSL, maskKeepWgsl } from './pageWgsl.ts'
import { PAGE_GEOMETRY_WGSL, UV_READ } from './pageGeometryWgsl.ts'
import { PAGE_SHAPE_WGSL } from './pageShapeWgsl.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import {
  COLOR_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  maskAlphaWgsl,
  materialDeclarations,
} from '../../materials/virtual/wgsl.ts'
import { VIS_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { maskUvWgsl } from './pageUvSetWgsl.ts'
import { VIS_WRITE_WGSL, pixelOffset } from '../raster/pixelWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { cornerBarycentric, wireframeEdge } from '../../../../math/src/wgsl/barycentric.ts'
import { DIAGNOSTIC_WIRE_WGSL } from '../../diagnostic/colors.ts'
import { FLAG_DYNAMIC, FLAG_MASK } from '../types.ts'
import { visTriangle } from '../visWords.ts'
import { CLIP_DISTANCES_WGSL, clippedStructText } from '../../gpu/core/clipDistances.ts'

/** The raster's one fragment stage, the override that compiles its mask test out for a slot
 *  that holds no cutout row (`MASKED` false), the opaque twins' constants, and the one that makes
 *  it the identifier phase of the visibility write (`ID_PHASE`, `../passes/pipelines.ts`). */
export const VIS_FRAGMENT = 'vis_hiz_fs'
export const VIS_UNMASKED = { MASKED: 0 }
export const VIS_ID_PHASE = 'ID_PHASE'

/** The hardware raster's second group: the visibility buffer both rasters write
 *  (`../raster/bindings.ts`, `hardwareWorkLayout`). */
export const VIS_WORK_BINDING = `@group(1) @binding(0) var<storage,read_write> work:array<atomic<u32>>;`

/** The members of the raster's vertex output, as the struct both stages share (`VSOut`). */
const VIS_MEMBERS = [
  '@builtin(position) @invariant position:vec4f',
  '@location(0) @interpolate(flat) id:u32',
  '@location(1) @interpolate(flat) instance:u32',
  '@location(2) tc:vec3f',
]

/** The struct of the raster's stages: on a device with `clip-distances` the vertex stage's own
 *  output beside it (`clippedStructText`), else one interpolant more, the distance of the vertex
 *  to the view's plane, which the fragment stage tests (`visClipTest`). */
const visOut = (native: boolean) =>
  native
    ? `struct VSOut{${VIS_MEMBERS.join(',')},}\n${clippedStructText('VSOut', VIS_MEMBERS)}`
    : `struct VSOut{${[...VIS_MEMBERS, '@location(3) clip:f32'].join(',')},}`

/** The distance of a vertex, at world position `world`, to the view's plane (`Uniforms.clipPlane`):
 *  zero for a view without one, which is kept. */
const VIS_CLIP = 'dot(uni.clipPlane.xyz,world.xyz)+uni.clipPlane.w'

/** The fragment stage's part of a device without `clip-distances`: the pixel behind the plane
 *  leaves, as the clipped primitive would not have covered it. */
const visClipTest = (native: boolean, leave: string) =>
  native ? '' : ` if(in.clip<0.0){${leave}}\n`

/** A vertex stage over the indirect slots, the hardware raster's (`vis_vs`) or the x-ray view's
 *  (`vis_xray_vs`): one text, ending with `tail`, what it writes into `tc`; `native`, the device
 *  has `clip-distances`: it then returns the struct that carries the clip distance. */
const visVertex = (entry: string, tail: string, native: boolean) =>
  `@vertex fn ${entry}(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->${native ? 'VSOutClipped' : 'VSOut'}{
 var out:VSOut;
 let at=drawBatch(instanceIndex);let pageIndex=at.x;let corner=at.y+vertexIndex;
 let page=pages[pageIndex];
 out.instance=pageIndex;out.tc=vec3f(0.0);
 if(corner>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return ${native ? 'VSOutWithClip(out,1.0)' : 'out'};}
 let h=pageHeaderFor(page,pageSurfaceRead(page));
 let shape=pageShape(page);
 let id=pageCorner(page,h,corner);
 let p=pagePosition(page,h,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 if(shape.lineWidth>0.0){out.position=pageLine(page,h,id,uni.viewProj*page.world,out.position,shape.lineWidth);}
 if(shape.sprite.y!=0.0){out.position=uni.viewProj*pageSprite(page,p,shape.sprite);}
 out.id=page.packedBase|visTriangle(corner/3u);
${tail} ${native ? `return VSOutWithClip(out,${VIS_CLIP});` : `out.clip=${VIS_CLIP};return out;`}
}
`

/** The vertex stage of the hardware raster, both halves': a row neither of the cut's masks holds
 *  never reaches it (`GpuDraw.encode`, `GpuDraw.encodePost`). */
const visRasterVertex = (native: boolean) =>
  visVertex(
    'vis_vs',
    ` if((page.flags&${UV_READ}u)==${UV_READ}u){out.tc=vec3f(pageMaskUv(page,h,id),0.0);}
 if((page.flags&${FLAG_MASK}u)!=0u){out.tc.z=pageMaskAlpha(page,h,id);}
`,
    native,
  )

/**
 * THE X-RAY VIEW (`xray`), a see-through wireframe — every triangle's edges, the hidden ones
 * too, both faces, no culling — over what the GPU cut submitted this image: the same
 * indirect slots, both halves, the rows the frustum, the cut's levels and its occlusion test
 * dropped already gone (`GpuDraw.encode`, `GpuDraw.encodePost`), drawn again with no depth test
 * and added
 * (`../passes/xray.ts`) — the software raster's rows too, from their own slots. Its vertex stage
 * is the raster's, its `tc` the corner's barycentric basis; its fragment the wireframe's
 * coverage of the edges (`wireframeEdge`, the barycentrics' change over one pixel as the blended
 * wireframe takes it) times the primitive's wire colour by its mobility (`diagnosticWireColor`).
 */
export const VIS_XRAY_VERTEX = 'vis_xray_vs',
  VIS_XRAY_FRAGMENT = 'vis_xray_fs'
const visXrayWgsl = (native: boolean) =>
  wgslBlock(
    `VIS_XRAY_WGSL(${native})`,
    [wireframeEdge, cornerBarycentric, DIAGNOSTIC_WIRE_WGSL],
    `${visVertex(VIS_XRAY_VERTEX, ' out.tc=cornerBarycentric(corner%3u);\n', native)}
@fragment fn ${VIS_XRAY_FRAGMENT}(in:VSOut)->@location(0) vec4f{
${visClipTest(native, 'discard;')} let coverage=wireframeEdge(in.tc,max(fwidth(in.tc),vec3f(1e-6)));
 if(coverage==0.0){discard;}
 return vec4f(diagnosticWireColor((pages[in.instance].flags&${FLAG_DYNAMIC}u)!=0u)*coverage,0.0);
}
`,
  )

/**
 * Hardware raster of the visibility buffer, for the clusters the split leaves it (`binWgsl.ts`):
 * those that cross a clip plane, whose edges project at the hardware threshold or more, and the
 * lines, sprites and voxel bricks. Its fragments write no attachment: each takes the visibility
 * write both rasters share (`VIS_WRITE_WGSL`) into `work`, at its depth plus its row's coplanar
 * units, the depth phase or the identifier phase as `ID_PHASE` says — the same slots drawn twice,
 * the second time once every depth of the image is down. The two phases compute the same position
 * (`@invariant`), so a fragment meets the key it wrote.
 */
export const visShader = ({
  diagnostic,
  clipDistances = false,
}: { diagnostic?: WgslDecl; clipDistances?: boolean } = {}) =>
  wgslProgram(
    `${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${PAGE_BINDING.uniforms}
${materialDeclarations()}
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
${VIS_WORK_BINDING}
// \`tc\` is the UV and, on a masked row, the vertex alpha of its cutout: one interpolant, as the UV
// alone was.
${visOut(clipDistances)}
${visRasterVertex(clipDistances)}
// A slot that holds no cutout row (no \`FLAG_MASK\`) is drawn with \`MASKED\` false: \`maskKeep\` keeps
// every pixel of such a row, so the pipeline's constant removes the page read and the cutout
// before the stage is compiled. One text, the mask test present only where a row can cut.
override MASKED:bool=true;
override ${VIS_ID_PHASE}:bool=false;
@fragment fn ${VIS_FRAGMENT}(in:VSOut){
 // The cutout's footprint, taken while every lane of the quad still runs.
 var gx=vec2f(0.0);var gy=vec2f(0.0);
 if(MASKED){gx=dpdx(in.tc.xy);gy=dpdy(in.tc.xy);}
${visClipTest(clipDistances, 'return;')} let page=pages[in.instance];
 let offset=pixelOffset(vec2u(in.position.xy));
 let key=visKey(in.position.z,page.depthBias);
 if(!visPasses(offset,key,${VIS_ID_PHASE})){return;}
 if(MASKED&&!maskKeep(page,in.tc.xy,in.tc.z,gx,gy)){return;}
 visWrite(offset,key,in.id,${VIS_ID_PHASE});
}
`,
    [
      PAGE_INFO_WGSL,
      TILE_POOL_WGSL,
      COLOR_SAMPLE_WGSL,
      PAGE_LOOKUP_WGSL,
      PAGE_SHAPE_WGSL,
      materialTableWgsl(VIS_BINDINGS.material),
      maskKeepWgsl(maskAlphaWgsl(false)),
      PAGE_GEOMETRY_WGSL,
      maskUvWgsl(VIS_BINDINGS.normals),
      VIS_WRITE_WGSL,
      pixelOffset,
      visTriangle,
      ...(clipDistances ? [CLIP_DISTANCES_WGSL] : []),
      ...(diagnostic ? [diagnostic] : []),
    ],
  )

/** The raster's module without a diagnostic stage and for a device without `clip-distances`: what
 *  production compiles there, and the text every audit reads; a device that has the feature
 *  compiles `visShader({ clipDistances: true })`. */
export const VIS_SHADER = visShader()

/** The x-ray pass's module: the raster's, with its x-ray stages (`visXrayWgsl`), assembled at
 *  its first use only, once for each way a device clips. */
const xrayShaders: Record<string, string> = {}
export const visXrayShader = (clipDistances = false) =>
  (xrayShaders[`${clipDistances}`] ??= visShader({
    diagnostic: visXrayWgsl(clipDistances),
    clipDistances,
  }))
