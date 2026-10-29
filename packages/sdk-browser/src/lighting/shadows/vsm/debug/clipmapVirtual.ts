import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { DISPLAY_FORMAT } from '../../../../scene/targetFormats.ts'
import { chainReady } from '../../../deferred/fullscreen.ts'
import {
  SCREEN_PASS_VERTEX,
  drawScreenPass,
  screenPassPipeline,
} from '../../../../diagnostic/screenPass.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_PAGE_LOOKUP_WGSL } from '../pageTableWgsl.ts'
import { vsmGrayscale, vsmIntToColor } from './pageColorWgsl.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmBindingsWgsl,
  type VsmBindingSpec,
} from '../resources.ts'

/** The view's name in `DiagnosticMode`. */
export const CLIPMAP_VIRTUAL_SPACE_VIEW = 'virtual-shadow-map-clipmap-virtual-space'

/** The pixels of black round the square the clipmap is drawn in. */
const BORDER = 2

/** The maps' records and page table, and the rect each map's allocated pages span (`vsmMappedRects`, the page management's), read by the fragment stage. */
const SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'projectionData', binding: 1 },
  { resource: 'pageTable', binding: 2 },
  { resource: 'mappedRects', binding: 3 },
]

/**
 * The view's shader: `fsClipmapDesaturate` lays the grey of the image copied in `sceneCopy`, `fsClipmapVirtualSpace` draws the sun's clipmap in the virtual space of its levels. The levels
 * are zoomed so that the allocated pages of the deepest level fill the square (`zoom`, widened by the coarser levels' rects); each pixel is looked up from the finest level to the coarsest,
 * and takes the colour of the last page that is mapped there: the hash of its address mixed with the hash of the level, three parts in four the level's.
 */
const CLIPMAP_WGSL = `struct ClipmapView{first:u32,levels:u32,border:u32,side:u32,}
@group(1) @binding(0) var<uniform> clipmapView:ClipmapView;
@group(1) @binding(1) var sceneCopy:texture_2d<f32>;
/** The place of the clipmap's origin in the map of level map 'id', in pages. */
fn clipmapOriginPages(id:u32)->vec2f{
 let record=vsmProjectionData[id];
 return (record.shiftedToMapUv*vec4f(record.clipmapOrigin,1.0)).xy;
}
/** The colour of the pixel at 'pixelUv' (0 to 1 over the square). */
fn clipmapColor(pixelUv:vec2f)->vec3f{
 var zoom=0.0;
 var deepest=-1;
 for(var i=i32(clipmapView.levels)-1;i>=0;i--){
  let id=clipmapView.first+u32(i);
  let bounds=vsmMappedRects[id*VSM_MIPS];
  if(bounds.x<=bounds.z&&bounds.y<=bounds.w){
   let centre=clipmapOriginPages(id)*f32(VSM_LEVEL0_PAGES);
   let extent=max(abs(vec2f(bounds.xy)-centre),abs(vec2f(bounds.zw)-centre));
   let fit=(2.0+max(extent.x,extent.y))/f32(VSM_LEVEL0_PAGES/2u);
   if(deepest<0){
    zoom=fit;
    deepest=i;
   }else{
    zoom=max(zoom,fit/f32(1u<<u32(deepest-i)));
   }
  }
 }
 if(deepest<0){return vec3f(0.0);}
 let centred=pixelUv-0.5;
 var color=vec3f(0.0);
 for(var i=deepest;i>=0;i--){
  let id=clipmapView.first+u32(i);
  let page=vec2i((centred*zoom+clipmapOriginPages(id))*f32(VSM_LEVEL0_PAGES));
  zoom*=2.0;
  if(any(page<vec2i(0))||any(page>=vec2i(i32(VSM_LEVEL0_PAGES)))){continue;}
  let entry=vsmTableEntryAtOffset(vsmTableEntryOf(vsmHandleFromId(id),0u,vec2u(page)));
  if(entry.thisLevelMapped){
   color=mix(vsmIntToColor(u32(page.x)+(u32(page.y)<<10u)),vsmIntToColor(u32(vsmProjectionData[id].mapLevel)),0.75);
  }
 }
 return color;
}
${SCREEN_PASS_VERTEX}
@fragment fn fsClipmapDesaturate(@builtin(position) position:vec4f)->@location(0) vec4f{
 let scene=textureLoad(sceneCopy,vec2i(position.xy),0);
 return vec4f(vec3f(vsmGrayscale(scene.rgb)),scene.a);
}
@fragment fn fsClipmapVirtualSpace(@builtin(position) position:vec4f)->@location(0) vec4f{
 let pixel=vec2u(position.xy);
 let border=vec2u(clipmapView.border);
 if(any(pixel<border)||any(pixel>border+vec2u(clipmapView.side))){discard;}
 return vec4f(clipmapColor(vec2f(pixel-border)/f32(clipmapView.side)),1.0);
}`

/** The view's program over a layout of the set. */
export const clipmapVirtualSpaceWgsl = (layout: VsmLayout) =>
  wgslProgram(CLIPMAP_WGSL, [
    VSM_CONSTANTS_WGSL,
    VSM_PAGE_LOOKUP_WGSL,
    vsmIntToColor,
    vsmGrayscale,
    vsmBindingsWgsl(0, SPECS, layout),
  ])

const PASS_DESATURATE = 'Trillion3D shadow clipmap desaturate'
const PASS_CLIPMAP = 'Trillion3D shadow clipmap virtual space'

/** What a runtime keeps of the view: the pipelines for the set's layout, the copy of the image and the view's words. */
interface ViewState {
  layout: VsmLayout
  groupLayouts: [GPUBindGroupLayout, GPUBindGroupLayout]
  desaturate: ReturnType<typeof screenPassPipeline>
  clipmap: ReturnType<typeof screenPassPipeline>
  params: GPUBuffer
  copy?: GPUTexture
}
const states = new WeakMap<object, ViewState>()

/** Gives the view's resources back. */
export function disposeClipmapVirtualSpace(rt: object) {
  const state = states.get(rt)
  state?.params.destroy()
  state?.copy?.destroy()
  states.delete(rt)
}

function stateOf(rt: WebgpuPagesRuntime, device: GPUDevice, layout: VsmLayout) {
  let state = states.get(rt)
  if (state?.layout === layout) return state
  if (state) disposeClipmapVirtualSpace(rt)
  const groupLayouts: ViewState['groupLayouts'] = [
    device.createBindGroupLayout({
      entries: vsmBindGroupLayoutEntries(SPECS, GPUShaderStage.FRAGMENT),
    }),
    device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    }),
  ]
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: groupLayouts })
  const code = clipmapVirtualSpaceWgsl(layout)
  states.set(
    rt,
    (state = {
      layout,
      groupLayouts,
      desaturate: screenPassPipeline(
        device,
        PASS_DESATURATE,
        code,
        'fsClipmapDesaturate',
        pipelineLayout,
      ),
      clipmap: screenPassPipeline(
        device,
        PASS_CLIPMAP,
        code,
        'fsClipmapVirtualSpace',
        pipelineLayout,
      ),
      params: device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    }),
  )
  return state
}

/**
 * THE CLIPMAP IN VIRTUAL SPACE (`virtual-shadow-map-clipmap-virtual-space`), over the display image: the image in grey, and over its middle a square that shows, level by level, the pages the first
 * sun's clipmap has mapped, each in the colour of its address and level. Nothing is drawn without a sun that casts shadows in the frame, or while the pipelines compile.
 */
export function encodeClipmapVirtualSpace(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { gpu } = rt
  const vsm = rt.lights?.vsm
  if (rt.run.diagnostic !== CLIPMAP_VIRTUAL_SPACE_VIEW || !gpu.displayView || !gpu.displayTexture)
    return disposeClipmapVirtualSpace(rt)
  const sun = vsm?.plan?.projected.find((lane) => lane.clipmap && !lane.firstPerson)
  if (!vsm || !sun?.clipmap) return
  const state = stateOf(rt, device, vsm.res.layout)
  if (!chainReady(state.desaturate, state.clipmap)) return
  const [width, height] = gpu.displaySize
  if (state.copy?.width !== width || state.copy.height !== height) {
    if (state.copy) retire(device, state.copy)
    state.copy = device.createTexture({
      label: PASS_DESATURATE,
      size: [width, height],
      format: DISPLAY_FORMAT,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    })
  }
  device.queue.writeBuffer(
    state.params,
    0,
    new Uint32Array([
      sun.firstId,
      sun.clipmap.levels.length,
      BORDER,
      Math.min(width, height) - 2 * BORDER,
    ]),
  )
  encoder.copyTextureToTexture({ texture: gpu.displayTexture }, { texture: state.copy }, [
    width,
    height,
  ])
  const groups = [
    device.createBindGroup({
      layout: state.groupLayouts[0],
      entries: vsmBindGroupEntries(vsm.res, SPECS),
    }),
    device.createBindGroup({
      layout: state.groupLayouts[1],
      entries: [
        { binding: 0, resource: { buffer: state.params } },
        { binding: 1, resource: state.copy.createView() },
      ],
    }),
  ]
  drawScreenPass(encoder, PASS_DESATURATE, state.desaturate.get()!, gpu.displayView, groups)
  drawScreenPass(encoder, PASS_CLIPMAP, state.clipmap.get()!, gpu.displayView, groups)
}
