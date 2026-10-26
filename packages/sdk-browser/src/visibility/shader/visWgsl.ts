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
import {
  NO_MASKS,
  maskKnowsPixel,
  maskMovesDepth,
  type MaskSet,
} from '../../materials/graph/maskProgram.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { wpoGraphWgsl } from './wpoGraphWgsl.ts'
import {
  OFFSET_DEPTH_WGSL,
  VIS_KEY_WGSL,
  pixelOffset,
  visWorkDeclaration,
  visWriteWgsl,
} from '../raster/pixelWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { cornerBarycentric, wireframeEdge } from '../../../../math/src/wgsl/barycentric.ts'
import { DIAGNOSTIC_WIRE_WGSL } from '../../diagnostic/colors.ts'
import { FLAG_DEPTH_OFFSET, FLAG_DYNAMIC, FLAG_MASK } from '../types.ts'
import { visTriangle } from '../visWords.ts'
import { planeDistance } from '../../../../math/src/wgsl/geometry.ts'
import {
  clipDirective,
  clippedStructText,
  clipReturn,
  clipReturnType,
  type Clipping,
} from '../../gpu/core/clipDistances.ts'

/** The raster's one fragment stage, the override that compiles its mask test out for a slot
 *  that holds no cutout row (`MASKED` false), and the opaque twins' constants
 *  (`../passes/pipelines.ts`). */
export const VIS_FRAGMENT = 'vis_hiz_fs'
export const VIS_UNMASKED = { MASKED: 0 }

/** The hardware raster's second group, on a device with the 64-bit atomic maximum: the visibility
 *  buffer both rasters write (`../raster/bindings.ts`, `hardwareWorkLayout`). */
const VIS_WORK_BINDING = visWorkDeclaration(true, 0, 1)
/** The work buffer's binding in a module whose fragments write it (`wide`), none in one that writes an attachment. */
export const hardwareWorkBinding = (wide: boolean) => (wide ? VIS_WORK_BINDING : '')

/** What the hardware raster's fragment writes on a device without the 64-bit word: the identifier
 *  into its colour attachment and the depth key as the fragment's depth, the hardware depth test
 *  keeping the nearest (`../passes/pipelines.ts`). */
export const VIS_OUT_WGSL = wgslBlock(
  'VIS_OUT_WGSL',
  [],
  `struct VisOut{@location(0) id:u32,@builtin(frag_depth) depth:f32,}
/** A fragment that leaves: discarded, its output never written. */
fn visLeft()->VisOut{discard;return VisOut(0u,0.0);}`,
)

/** The members of the raster's vertex output, as the struct both stages share (`VSOut`). */
const VIS_MEMBERS = [
  '@builtin(position) position:vec4f',
  '@location(0) @interpolate(flat) id:u32',
  '@location(1) @interpolate(flat) instance:u32',
  '@location(2) tc:vec3f',
]

/** The struct of the raster's stages: as it was where the module does not cut at the view's plane;
 *  cutting by distance, the vertex stage's own output beside it (`clippedStructText`); cutting by
 *  pixel, one interpolant more, the distance of the vertex to the plane, which the fragment stage
 *  tests (`visClipTest`). */
const visOut = (clipping?: Clipping) =>
  clipping === 'distance'
    ? `struct VSOut{${VIS_MEMBERS.join(',')},}\n${clippedStructText('VSOut', VIS_MEMBERS)}`
    : `struct VSOut{${(clipping ? [...VIS_MEMBERS, '@location(3) clip:f32'] : VIS_MEMBERS).join(',')},}`

/** The distance of a vertex, at world position `world`, to the view's plane (`Uniforms.clipPlane`):
 *  zero for a view without one, which is kept. */
const VIS_CLIP = 'planeDistance(uni.clipPlane,world.xyz)'

/** The fragment stage's part of a module that cuts by pixel: the pixel behind the plane leaves, as
 *  the clipped primitive would not have covered it. */
const visClipTest = (clipping: Clipping | undefined, leave: string) =>
  clipping === 'pixel' ? ` if(in.clip<0.0){${leave}}\n` : ''

/** A vertex stage over the indirect slots, the hardware raster's (`vis_vs`) or the x-ray view's
 *  (`vis_xray_vs`): one text, ending with `tail`, what it writes into `tc`; cutting by distance it
 *  returns the struct that carries the clip distance, by pixel it writes the distance in `clip`. */
const visVertex = (entry: string, tail: string, clipping?: Clipping) =>
  `@vertex fn ${entry}(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->${clipReturnType('VSOut', clipping)}{
 var out:VSOut;
 let at=drawBatch(instanceIndex);let pageIndex=at.x;let corner=at.y+vertexIndex;
 let page=pages[pageIndex];
 out.instance=pageIndex;out.tc=vec3f(0.0);
 if(corner>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return ${clipReturn('VSOut', clipping, 'out', '1.0')};}
 let h=pageHeaderFor(page,pageSurfaceRead(page));
 let shape=pageShape(page);
 let id=pageCorner(page,h,corner);
 let p=pagePosition(page,h,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 if(shape.lineWidth>0.0){out.position=pageLine(page,h,id,uni.viewProj*page.world,out.position,shape.lineWidth);}
 if(shape.sprite.y!=0.0){out.position=uni.viewProj*pageSprite(page,p,shape.sprite);}
 out.id=page.packedBase|visTriangle(corner/3u);
${tail} ${visClipEnd(clipping)}
}
`

/** What a vertex stage ends with: its output, with the distance to the plane where it cuts. */
const visClipEnd = (clipping?: Clipping) =>
  clipping === 'pixel'
    ? `out.clip=${VIS_CLIP};return out;`
    : `return ${clipReturn('VSOut', clipping, 'out', VIS_CLIP)};`

/** The vertex stage of the hardware raster, both halves': a row neither of the cut's masks holds
 *  never reaches it (`GpuDraw.encode`, `GpuDraw.encodePost`). */
const visRasterVertex = (clipping?: Clipping) =>
  visVertex(
    'vis_vs',
    ` if((page.flags&${UV_READ}u)==${UV_READ}u){out.tc=vec3f(pageMaskUv(page,h,id),0.0);}
 if((page.flags&${FLAG_MASK}u)!=0u){out.tc.z=pageMaskAlpha(page,h,id);}
`,
    clipping,
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
const visXrayWgsl = (clipping?: Clipping) =>
  wgslBlock(
    `VIS_XRAY_WGSL(${clipping})`,
    [wireframeEdge, cornerBarycentric, DIAGNOSTIC_WIRE_WGSL],
    `${visVertex(VIS_XRAY_VERTEX, ' out.tc=cornerBarycentric(corner%3u);\n', clipping)}
@fragment fn ${VIS_XRAY_FRAGMENT}(in:VSOut)->@location(0) vec4f{
${visClipTest(clipping, 'discard;')} let coverage=wireframeEdge(in.tc,max(fwidth(in.tc),vec3f(1e-6)));
 if(coverage==0.0){discard;}
 return vec4f(diagnosticWireColor((pages[in.instance].flags&${FLAG_DYNAMIC}u)!=0u)*coverage,0.0);
}
`,
  )

/** The raster's fragment stage: the cutout's footprint taken while every lane of the quad still
 *  runs; the pixel behind the view's plane leaves (`visClipTest`); the cutout test, compiled out for
 *  a slot that holds no cutout row (`MASKED`); then the pair into the buffer's word (`wide`) or the
 *  identifier and the depth key out. */
const visFragment = (
  wide: boolean,
  clipping: Clipping | undefined,
  graphPixel: boolean,
  moves: boolean,
) => {
  const keep = graphPixel
    ? 'maskKeepAt(page,in.tc.xy,in.tc.z,gx,gy,in.position.xy)'
    : 'maskKeep(page,in.tc.xy,in.tc.z,gx,gy)'
  const head = ` var gx=vec2f(0.0);var gy=vec2f(0.0);
 if(MASKED){gx=dpdx(in.tc.xy);gy=dpdy(in.tc.xy);}
`
  // The depth the fragment is written at: its own, or, a row whose surface wires a `pixelDepthOffset`,
  // the one that output moves it to (`offsetDepth`), its clip w the reciprocal of the fragment's w.
  const depth = moves
    ? ` var z=in.position.z;
 if(MASKED&&(page.flags&${FLAG_DEPTH_OFFSET}u)!=0u){
  z=offsetDepth(z,1.0/in.position.w,depthOffsetValue(materialAt(page.material),in.tc.xy,gx,gy),in.position.xy);
 }
`
    : ''
  const z = moves ? 'z' : 'in.position.z'
  if (wide)
    return `@fragment fn ${VIS_FRAGMENT}(in:VSOut){
${head}${visClipTest(clipping, 'return;')} let page=pages[in.instance];
 if(MASKED&&!${keep}){return;}
${depth} visWrite(pixelOffset(vec2u(in.position.xy)),visKey(${z},page.depthBias),in.id,false);
}`
  return `@fragment fn ${VIS_FRAGMENT}(in:VSOut)->VisOut{
${head}${visClipTest(clipping, 'return visLeft();')} let page=pages[in.instance];
 if(MASKED&&!${keep}){return visLeft();}
${depth} return VisOut(in.id,bitcast<f32>(visKey(${z},page.depthBias)));
}`
}

/**
 * Hardware raster of the visibility buffer, for the clusters the cut's cull leaves it (`rasteredInHardware`, `../../geometry/dag/shader/visibleWgsl.ts`):
 * those that cross a clip plane, whose edges project at the hardware threshold or more, and the
 * lines, sprites and voxel bricks. Each triangle is drawn once.
 * - **With the 64-bit atomic maximum** (`wide`) its fragments write no attachment: each takes the
 *   visibility write both rasters share (`visWriteWgsl`) into `work`, its pair — the identifier and
 *   the depth plus its row's coplanar units — taken in by the maximum.
 * - **Without it** the fragments write a colour attachment, their identifier, and the fragment's
 *   depth, the depth key (`VIS_OUT_WGSL`): the hardware depth test keeps the nearest, and the
 *   export merges the two rasters (`../raster/exportWgsl.ts`).
 * With `wpo`, a row whose surface wires a `worldPositionOffset` has each vertex moved by it
 * (`pagePosition`, `wpoGraphWgsl.ts`); with `masks`, one that wires a `pixelDepthOffset` has each
 * fragment written at the depth that output gives it (`offsetDepth`, `../raster/pixelWgsl.ts`).
 */
export const visShader = ({
  diagnostic,
  clipping,
  masks = NO_MASKS,
  wpo = NO_WPO,
  wide = false,
}: {
  diagnostic?: WgslDecl
  clipping?: Clipping
  masks?: MaskSet
  wpo?: WpoSet
  wide?: boolean
} = {}) => {
  const moves = maskMovesDepth(masks)
  return wgslProgram(
    `${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${PAGE_BINDING.uniforms}
${materialDeclarations()}
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
${hardwareWorkBinding(wide)}
// \`tc\` is the UV and, on a masked row, the vertex alpha of its cutout: one interpolant, as the UV
// alone was.
${visOut(clipping)}
${visRasterVertex(clipping)}
// A slot that holds no cutout row (no \`FLAG_MASK\`) is drawn with \`MASKED\` false: \`maskKeep\` keeps
// every pixel of such a row, so the pipeline's constant removes the page read and the cutout
// before the stage is compiled. One text, the mask test present only where a row can cut.
override MASKED:bool=true;
${visFragment(wide, clipping, maskKnowsPixel(masks), moves)}
`,
    [
      PAGE_INFO_WGSL,
      TILE_POOL_WGSL,
      COLOR_SAMPLE_WGSL,
      PAGE_LOOKUP_WGSL,
      PAGE_SHAPE_WGSL,
      materialTableWgsl(VIS_BINDINGS.material),
      maskKeepWgsl(maskAlphaWgsl(false), masks),
      PAGE_GEOMETRY_WGSL,
      maskUvWgsl(VIS_BINDINGS.normals),
      ...(wide ? [visWriteWgsl(true), pixelOffset] : [VIS_KEY_WGSL, VIS_OUT_WGSL]),
      visTriangle,
      ...clipDirective(clipping),
      ...(clipping ? [planeDistance] : []),
      ...(diagnostic ? [diagnostic] : []),
      ...(moves ? [OFFSET_DEPTH_WGSL] : []),
      ...(wpo.programs.length ? [wpoGraphWgsl(wpo)] : []),
    ],
  )
}

/** The x-ray pass's module: the raster's, with its x-ray stages (`visXrayWgsl`), assembled at
 *  its first use only, once for each way to cut at the plane, or none. */
const xrayShaders: Record<string, string> = {}
export const visXrayShader = (clipping?: Clipping) =>
  (xrayShaders[`${clipping}`] ??= visShader({ diagnostic: visXrayWgsl(clipping), clipping }))
