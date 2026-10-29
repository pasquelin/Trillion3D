import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import { VIRTUAL_SHADOW_MAP_VIEWS } from '../../../../../../sdk-core/src/runtime/diagnostics.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { debugColor } from '../../../../hair/debugLines.ts'
import { createTextOverlay, TEXT_LINE } from '../../../../diagnostic/textOverlay.ts'
import {
  SCREEN_PASS_VERTEX,
  drawScreenPass,
  screenPassGroup,
  screenPassPipeline,
} from '../../../../diagnostic/screenPass.ts'
import { DISPLAY_FORMAT } from '../../../../scene/targetFormats.ts'
import { chainReady } from '../../../deferred/fullscreen.ts'
import { modeConstant, VSM_VISUALIZE_RAY_COLOR_WGSL } from '../projection/visualizeWgsl.ts'
import { vsmMapSettings } from '../frame/vsmFarShadow.ts'
import { vsmGrayscale } from './pageColorWgsl.ts'
import { vsmVisualizeStateOf } from '../projection/visualizePass.ts'

/** The pass that lays a view over the image. */
const PASS = 'Trillion3D shadow map view'

/**
 * The screen pass of the virtual shadow map views: where the layout (`shadowVisualizeLayout`) says, the image in grey with the view over it (the whole image, 0), or the view alone in a
 * thumbnail of a third of the image's width and height at its upper left (1) or over its left half (2). `vizView` holds the display size, the size of the view's target, the layout, the mode id
 * and whether one light is shown; the ray count view is turned to its colour here, from the rays traced over the most (`vsmRayCountColor`).
 */
const VIEW_WGSL = `struct VizView{display:vec2u,source:vec2u,layout:u32,mode:u32,one:u32,spare:u32,}
@group(0) @binding(0) var<uniform> vizView:VizView;
@group(0) @binding(1) var sceneCopy:texture_2d<f32>;
@group(0) @binding(2) var vizColour:texture_2d<f32>;
const ${modeConstant('virtual-shadow-map-ray-count')}:u32=${VIRTUAL_SHADOW_MAP_VIEWS['virtual-shadow-map-ray-count']}u;
${SCREEN_PASS_VERTEX}
@fragment fn fsVsmView(@builtin(position) position:vec4f)->@location(0) vec4f{
 let pixel=vec2u(position.xy);
 let scene=textureLoad(sceneCopy,vec2i(pixel),0);
 var region=vizView.display;
 var source=vizView.source;
 if(vizView.layout==1u){region=vizView.display/3u;}
 if(vizView.layout==2u){region.x=vizView.display.x/2u;source.x=source.x/2u;}
 if(vizView.layout>0u&&any(pixel>=region)){discard;}
 let texel=min(vec2u((vec2f(pixel)+0.5)/vec2f(region)*vec2f(source)),source-vec2u(1u));
 var colour=textureLoad(vizColour,vec2i(texel),0);
 if(vizView.mode==${modeConstant('virtual-shadow-map-ray-count')}&&colour.a>0.0){colour=vec4f(vsmRayCountColor(colour.xy,vizView.one!=0u),colour.a);}
 if(vizView.layout>0u){return vec4f(colour.rgb,1.0);}
 let grey=vec3f(dot(scene.rgb,vec3f(0.299,0.587,0.114)));
 return vec4f(mix(grey,colour.rgb,colour.a),scene.a);
}`

const CODE = wgslProgram(VIEW_WGSL, [VSM_VISUALIZE_RAY_COLOR_WGSL, vsmGrayscale])

/** The legend's entries of a view: a label and its colour, for the views that have one. */
const LEGENDS: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
  'virtual-shadow-map-shadow-factor': [
    ['Lit', debugColor(1, 1, 0)],
    ['Shadow', debugColor(0, 0, 1)],
  ],
}
const CACHED_KEPT: readonly [string, number] = ['Cached', debugColor(0, 1, 0)]
const CACHED_REDRAWN: readonly (readonly [string, number])[] = [
  ['All Invalidated', debugColor(1, 0, 0)],
  ['Dynamic Invalidated', debugColor(0, 0, 1)],
  ['Force cached', debugColor(0.75, 1, 0)],
]

/** The legend of the cached-page view: the kept pages are drawn for one light or where only they are asked, the others unless only the kept are. */
export const cachedPageLegend = (oneLight: boolean, cachedOnly: boolean) => [
  ...(oneLight || cachedOnly ? [CACHED_KEPT] : []),
  ...(cachedOnly ? [] : CACHED_REDRAWN),
]

/** The name of a view as the legend writes it: its words, capitalised. */
export const viewTitle = (view: string) =>
  view
    .replace('virtual-shadow-map-', '')
    .split('-')
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')

/** What a runtime keeps of the screen pass. */
interface ViewState {
  pipeline: ReturnType<typeof screenPassPipeline>
  params: GPUBuffer
  copy?: GPUTexture
  overlay: ReturnType<typeof createTextOverlay>
}
const states = new WeakMap<object, ViewState>()

/** Gives the screen pass's resources back. */
export function disposeVsmVisualizeView(rt: object) {
  const state = states.get(rt)
  if (!state) return
  state.params.destroy()
  state.copy?.destroy()
  state.overlay.dispose()
  states.delete(rt)
}

/**
 * THE VIRTUAL SHADOW MAP VIEWS (`virtual-shadow-map-shadow-factor` and the eight others, `VIRTUAL_SHADOW_MAP_VIEWS`), over the display image: what the projection of the frame drew
 * (`encodeVsmVisualize`) laid over the image in grey, by the layout of `shadowVisualizeLayout`, with the view's title, the name of the light it shows and its legend at the lower left.
 * Nothing is drawn while the pipeline compiles or the projection drew no view.
 */
export function encodeVsmVisualizeView(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const diagnostic = rt.run.diagnostic
  const vsm = rt.lights.vsm
  const shown = vsm && vsmVisualizeStateOf(vsm.res)?.result
  if (
    !diagnostic ||
    !(diagnostic in VIRTUAL_SHADOW_MAP_VIEWS) ||
    !gpu.displayView ||
    !gpu.displayTexture
  )
    return disposeVsmVisualizeView(rt)
  if (!shown) return
  let state = states.get(rt)
  if (!state)
    states.set(
      rt,
      (state = {
        pipeline: screenPassPipeline(device, PASS, CODE, 'fsVsmView'),
        params: device.createBuffer({
          label: PASS,
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        overlay: createTextOverlay(device),
      }),
    )
  if (!chainReady(state.pipeline)) return
  const [width, height] = gpu.displaySize
  if (state.copy?.width !== width || state.copy.height !== height) {
    if (state.copy) retire(device, state.copy)
    state.copy = device.createTexture({
      label: PASS,
      size: [width, height],
      format: DISPLAY_FORMAT,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    })
  }
  const { request } = shown
  const vizSize = vsmVisualizeStateOf(vsm.res)!
  const one = request.light >= 0
  const layout = vsmMapSettings(rt).shadows.shadowVisualizeLayout
  device.queue.writeBuffer(
    state.params,
    0,
    new Uint32Array([
      width,
      height,
      vizSize.width,
      vizSize.height,
      layout,
      request.mode,
      one ? 1 : 0,
      0,
    ]),
  )
  encoder.copyTextureToTexture({ texture: gpu.displayTexture }, { texture: state.copy }, [
    width,
    height,
  ])
  drawScreenPass(encoder, PASS, state.pipeline.get()!, gpu.displayView, [
    screenPassGroup(device, state.pipeline.get()!, [
      { buffer: state.params },
      state.copy.createView(),
      shown.view,
    ]),
  ])
  // The title, with the light shown, and the legend of the view, at the lower left of the region the view covers.
  const lightName = one ? vsm.plan?.projected[request.light]?.id : undefined
  const title = viewTitle(diagnostic)
  const entries =
    diagnostic === 'virtual-shadow-map-cached-page'
      ? cachedPageLegend(one, request.cachedOnly)
      : (LEGENDS[diagnostic] ?? [])
  // The lower left of the region the view covers: the thumbnail's, else the image's.
  const top = (layout === 1 ? Math.floor(height / 3) : height) - 100
  state.overlay.begin(cam)
  state.overlay.lines.text(
    lightName ? `${title} (${lightName})` : title,
    8,
    top - TEXT_LINE,
    debugColor(1, 1, 1),
  )
  entries.forEach(([label, color], at) =>
    state.overlay.lines.text(label, 8, top + at * TEXT_LINE, color),
  )
  state.overlay.encode(encoder, gpu.displayView, gpu.displaySize, cam)
}
