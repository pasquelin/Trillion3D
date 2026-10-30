import { TOON_TABLES_NONE_WGSL } from '../../../toon/tablesWgsl.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { skyLightReadOf } from '../../../../frame/render/skyLightState.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { pixelModelOf } from '../../../../materials/surface/pixelModel.ts'
import { DIRECT_LIGHT_WGSL } from '../../../direct/lightWgsl.ts'
import { LOBES_LIGHTING_WGSL } from '../../../direct/lobesWgsl.ts'
import { SKY_READ_WGSL } from '../../../atmosphere/skyReadWgsl.ts'
import { VIEW_RAY_WGSL } from '../../../deferred/worldAtWgsl.ts'
import { reflectionGroup, reflectionLightView } from '../../../reflections/group.ts'
import { reflectionsPending } from '../../../reflections/gpu.ts'
import { REFLECTION_PIXEL_TRACES_WGSL } from '../../../reflections/reach.ts'
import { reflectionLayout } from '../../../reflections/reflectionPipelines.ts'
import { REFLECTION_TRACE_BINDINGS } from '../../../reflections/trace/traceBindings.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from '../../../reflections/viewLayout.ts'
import { toneReadEntries } from '../../../toneLutRead.ts'
import type { TileRect } from '../../visualizeModes.ts'
import type { ProbeDebug } from '../probeTables.ts'
import { visualizeTonemapBindings, visualizeTonemapReadWgsl } from '../visualizeTonemap.ts'
import { HARDWARE_RADIANCE_FORMAT } from './answerWgsl.ts'
import { HARDWARE_FLAG, HARDWARE_PARAMS, HARDWARE_TILE, hardwareParamsOf } from './layout.ts'
import type { HardwareTarget } from './target.ts'

const LABEL = 'Trillion3D debug dedicated reflection rays'
const S = REFLECTION_TRACE_BINDINGS
/** The bindings of group 0 beside the surfaces' (`REFLECTION_TRACE_BINDINGS`): the composition's table with the lighting's view's place before it, the parameters, the radiance written, the base colour. */
const AT = { tone: 70, params: 74, shown: 75, base: 76, lights: 77 } as const
const ENTRY = 'dedicatedReflectionRays'
/** The direction the mark's light comes from, as the reference's view lights the surface it is drawn over. */
const LIGHT = '0.707,0.0,0.707'

/**
 * THE PIXELS THAT TRACE DEDICATED REFLECTION RAYS (`ENTRY`), a thread a pixel of the draw: the surface of the pixel the reflections read (`reflectionPixelTraces`, the one decision their stage makes: a clear coat, or
 * a lobe smooth enough) is red, green for a foliage pixel (`reflectionFoliage`), the darker the rougher; the pixels that trace none are the surface's albedo lit from one side, as a grey; the sky is the sky
 * light's radiance through the composition's table. Written to the radiance texture the blit lays over the display.
 */
export const dedicatedRaysWgsl = wgslProgram(
  `${HARDWARE_PARAMS.wgsl}
@group(0) @binding(${AT.params}) var<uniform> scene:HardwareParams;
@group(0) @binding(${AT.shown}) var shown:texture_storage_2d<${HARDWARE_RADIANCE_FORMAT},write>;
@group(0) @binding(${AT.base}) var baseMetal:texture_2d<f32>;
@group(0) @binding(${AT.lights}) var<storage,read> directLights:DirectLights;
@compute @workgroup_size(${HARDWARE_TILE},${HARDWARE_TILE},1)
fn ${ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=scene.size.xy)){return;}
 let display=vec2f(scene.size.zw);
 let pixel=(vec2f(id.xy)+vec2f(0.5))/vec2f(scene.size.xy)*display;
 let drawn=view.viewport.xy;
 let at=vec2i(min(pixel/display*drawn,drawn-vec2f(1.0)));
 var colour=vec3f(0.0);
 if(surfaceDepthAt(0u,at)==0.0){
  colour=visualizeTonemap(skyRadiance(viewRay(pixel,display)),scene.flags.y!=0u);
 }else{
  let flags=surfaceFlagsAt(at);
  let normal=surfaceNormalAt(at);
  let base=textureLoad(baseMetal,at,0);
  let lighting=0.5*dot(vec3f(${LIGHT}),normalize(normal.xyz))+0.5;
  let albedo=base.rgb*(1.0-base.a);
  colour=vec3f(sqrt(dot(albedo,vec3f(0.2126,0.7152,0.0722))*lighting*1.5));
  if(reflectionPixelTraces(at,flags)){
   colour=select(vec3f(1.0,0.0,0.0),vec3f(0.0,1.0,0.0),reflectionFoliage(flags))*((1.0-normal.a)*0.8+0.2);
  }
 }
 textureStore(shown,id.xy,vec4f(saturate(colour),1.0));
}`,
  [
    REFLECTION_PIXEL_TRACES_WGSL,
    LOBES_LIGHTING_WGSL,
    // Toon pixels are not lit here: the tables the toon code reads answer zero.
    TOON_TABLES_NONE_WGSL,
    DIRECT_LIGHT_WGSL,
    reflectionLightViewWgsl(REFLECTION_GROUP),
    SKY_READ_WGSL,
    VIEW_RAY_WGSL,
    visualizeTonemapReadWgsl(AT.tone),
    pixelModelOf,
  ],
)

/** The kernel, compiled off the frame: group 0 the surfaces and its own bindings, group 1 the reflection's. */
const kernel = oncePerDevice((device: GPUDevice) => {
  const stage = (binding: number, sampleType: GPUTextureSampleType) =>
    computeTextureEntry(binding, sampleType)
  const layout = device.createBindGroupLayout({
    label: LABEL,
    entries: [
      stage(S.flags, 'uint'),
      stage(S.normals, 'unfilterable-float'),
      stage(S.lobes, 'uint'),
      stage(AT.base, 'unfilterable-float'),
      computeUniformEntry(AT.params),
      computeBufferEntry(AT.lights, 'read-only-storage'),
      computeStorageTextureEntry(AT.shown, HARDWARE_RADIANCE_FORMAT),
      ...toneReadEntries(AT.tone + 1, GPUShaderStage.COMPUTE),
    ],
  })
  return {
    layout,
    stages: startedComputeStages(
      device,
      LABEL,
      device.createPipelineLayout({ bindGroupLayouts: [layout, reflectionLayout(device)] }),
      device.createShaderModule({ label: LABEL, code: dedicatedRaysWgsl }),
      [ENTRY],
    ),
  }
})

/**
 * Draws number `draw` of the image, the dedicated reflection rays view over `rect` of the display of `size`, into the radiance texture of `target` and over the display; false when the surfaces
 * the reflections read, their stage's group or the kernel are not there yet.
 */
export function encodeDedicatedRays(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  target: HardwareTarget,
  words: Uint32Array<ArrayBuffer>,
  display: GPUTextureView,
  size: readonly [number, number],
  view: ProbeDebug,
  draw: number,
  rect: TileRect,
  tiled: boolean,
) {
  const { gpu } = rt
  const { reflection, surfaces, deferred } = gpu
  const depth = rt.vis.gpuHiz?.depth()
  const lightView = reflectionLightView(rt)
  const lights = rt.lights.buffer
  const tone = visualizeTonemapBindings(rt)
  const made = kernel(device)
  const views = surfaces?.views()
  if (
    !reflection ||
    reflectionsPending(reflection) ||
    !deferred ||
    !surfaces?.lobesView ||
    !depth ||
    !lightView ||
    !lights ||
    !tone ||
    !views ||
    views.slice(0, 4).some((each) => !each) ||
    !made.stages.ready ||
    !target.ready
  )
    return false
  const draws = [rect.width, rect.height] as const
  const textures = target.texturesOf(draws, false)
  const parameters = target.paramsOf(
    draw,
    hardwareParamsOf(words, {
      draw: draws,
      display: size,
      rect,
      trace: [0, 0, 0, 0],
      flags: tiled ? HARDWARE_FLAG.tiled : 0,
      tonemap: view.sceneToneMap && tone.baked,
      culling: 0,
      fogSky: 0,
    }),
  )
  const group = device.createBindGroup({
    label: LABEL,
    layout: made.layout,
    entries: [
      { binding: S.flags, resource: views[3]! },
      { binding: S.normals, resource: views[1]! },
      { binding: S.lobes, resource: surfaces.lobesView },
      { binding: AT.base, resource: views[0]! },
      { binding: AT.params, resource: { buffer: parameters } },
      { binding: AT.lights, resource: { buffer: lights } },
      { binding: AT.shown, resource: textures.radiance!.createView() },
      ...tone.resources.slice(1).map((resource, k) => ({ binding: AT.tone + 1 + k, resource })),
    ],
  })
  const pass = encoder.beginComputePass({ label: LABEL })
  pass.setPipeline(made.stages.pipelineOf(ENTRY))
  pass.setBindGroup(0, group)
  pass.setBindGroup(1, reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt)))
  pass.dispatchWorkgroups(ceilDiv(rect.width, HARDWARE_TILE), ceilDiv(rect.height, HARDWARE_TILE))
  pass.end()
  target.blit(encoder, display, rect, parameters)
  return true
}
