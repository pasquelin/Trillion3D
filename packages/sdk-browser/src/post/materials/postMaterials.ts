import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type { ChainedBlendable } from '../../../../sdk-core/src/world/effect/blendables.ts'
import {
  blendableOf,
  type BlendableLocation,
} from '../../../../sdk-core/src/world/material/postProcessMaterial.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import { uniformBlock, type UniformBlock } from '../../gpu/core/uniformBlock.ts'
import { drawFullscreenTriangle, FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { POST_MATERIAL_PASS } from '../../diagnostic/stage/passLabels.ts'
import { CANVAS_FORMAT } from '../../gpu/core/canvasFormat.ts'
import { DEPTH_FORMAT, DISPLAY_FORMAT } from '../../scene/targetFormats.ts'
import { fullscreenDraw } from '../filters/fullscreenDraw.ts'
import { sizedImage } from '../filters/sizedImage.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { CUSTOM_STENCIL_FORMAT } from '../../visibility/customDepth/customDepthWgsl.ts'
import { POST_BINDINGS, POST_VIEW } from './postLayout.ts'
import {
  blendOf,
  exposureScales,
  writePostGiven,
  writePostView,
  type PostViewInput,
} from './postParams.ts'
import { usablePostProgram, type PostProgram } from './postProgram.ts'
import { POST_MATERIAL_ENTRY } from './postWgsl.ts'

/** What the material passes of one location are handed (`PostMaterials.apply`). */
export interface PostCall {
  readonly encoder: GPUCommandEncoder
  readonly location: BlendableLocation
  /** The materials of the location, in the order they run (`Blendables.chainAt`). */
  readonly chain: readonly ChainedBlendable[]
  /** The image they read and draw over, of `format`. */
  readonly input: GPUTextureView
  readonly format: GPUTextureFormat
  /** The sizes and the projection of the image (`PostViewInput`). */
  readonly frame: PostViewInput
  /** The lit image, its depth, and the custom depth targets: their stencil where it is allocated (`customDepth` 3), whether or not an object asked. */
  readonly lit: GPUTextureView
  readonly depth: GPUTextureView
  readonly customDepth: GPUTextureView | undefined
  readonly customStencil: GPUTextureView | undefined
  readonly stencilAllocated: boolean
  readonly clocks: { time: number; realTime: number }
  /** The pre-exposure of the image (`PreExposure.now`). */
  readonly preExposure: number
  /** The settings (`postProcessAllowStencilTest`, `postProcessAllowBlendModes`). */
  readonly allowStencil: boolean
  readonly allowBlend: boolean
}

/** The calls a pair of targets may go unused before another extent's making gives it back. */
const STALE = 16

/** What one material keeps for its pass: the frame's uniform and its own, and the group over the images it names. */
interface MaterialState {
  readonly view: UniformBlock
  given: UniformBlock
  givenBytes: number
  readonly identity: ReturnType<typeof createWebgpuBindIdentity>
  group: GPUBindGroup | undefined
}

/** The copy of the last image of the display chain onto the display image and the canvas it was presented to. */
export const POST_COPY_WGSL = `@group(0) @binding(0) var ppCopySource:texture_2d<f32>;
struct PpCopyOut{@location(0) display:vec4f,@location(1) canvas:vec4f,}
@fragment fn copy(@builtin(position) at:vec4f)->@location(0) vec4f{return textureLoad(ppCopySource,vec2i(at.xy),0);}
@fragment fn copyPresent(@builtin(position) at:vec4f)->PpCopyOut{
 let c=textureLoad(ppCopySource,vec2i(at.xy),0);
 return PpCopyOut(c,c);
}`

/** The device's layout of the pass, its sampler and the stand-ins of the images a frame may not have: a far depth, a zero stencil. */
const deviceKit = oncePerDevice((device: GPUDevice) => {
  const fragment = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: POST_MATERIAL_PASS,
    entries: [
      computeUniformEntry(POST_BINDINGS.view, {}, fragment),
      computeUniformEntry(POST_BINDINGS.given, {}, fragment),
      computeTextureEntry(POST_BINDINGS.input, 'float', '2d', fragment),
      computeTextureEntry(POST_BINDINGS.sceneColor, 'float', '2d', fragment),
      computeTextureEntry(POST_BINDINGS.sceneDepth, 'depth', '2d', fragment),
      computeTextureEntry(POST_BINDINGS.customDepth, 'depth', '2d', fragment),
      computeTextureEntry(POST_BINDINGS.customStencil, 'uint', '2d', fragment),
      computeSamplerEntry(POST_BINDINGS.sampler, 'filtering', fragment),
    ],
  })
  const copyLayout = device.createBindGroupLayout({
    label: `${POST_MATERIAL_PASS} copy`,
    entries: [computeTextureEntry(0, 'float', '2d', fragment)],
  })
  const copyModule = device.createShaderModule({
    label: `${POST_MATERIAL_PASS} copy`,
    code: wgslProgram(POST_COPY_WGSL, [FULLSCREEN_VERTEX]),
  })
  const targets = [{ format: DISPLAY_FORMAT }]
  return {
    layout,
    copyLayout,
    sampler: postSamplers(device).clamped,
    noDepth: standInTexture(device, `${POST_MATERIAL_PASS} no depth`, DEPTH_FORMAT).createView(),
    noStencil: standInTexture(
      device,
      `${POST_MATERIAL_PASS} no stencil`,
      CUSTOM_STENCIL_FORMAT,
    ).createView(),
    copy: preparedPipeline(
      device,
      fullscreenDescriptor(device, copyModule, copyLayout, 'copy', targets, 'copy'),
    ),
    copyPresent: preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        copyModule,
        copyLayout,
        'copyPresent',
        [...targets, { format: CANVAS_FORMAT }],
        'copy present',
      ),
    ),
  }
})

/**
 * THE POST-PROCESS MATERIALS ON WEBGPU (`material.postProcess`, joined by `world.effects.blendables`): the full-screen passes that draw
 * each material of a location over the image, one after the other, each reading what the one before wrote. A material's program is its
 * graph compiled once (`postProgramOf`) and its pipeline prepared off the frame for the format of the image it draws; until it lands the
 * material is left out and the frame held on it. Two images of the image's format take turns as the targets; nothing is made before the
 * first material draws.
 */
export function createPostMaterials(device: GPUDevice) {
  const kit = deviceKit(device)
  /** The states of each material, one for every time the call names it: a material added again that may not be blended draws twice. */
  const states = new Map<Material, MaterialState[]>()
  const modules = new Map<string, GPUShaderModule>()
  const pipelines = new Map<
    PostProgram,
    Map<GPUTextureFormat, ReturnType<typeof preparedPipeline>>
  >()
  const pipelineOf = (program: PostProgram, format: GPUTextureFormat) => {
    let byFormat = pipelines.get(program)
    if (!byFormat) pipelines.set(program, (byFormat = new Map()))
    let pipeline = byFormat.get(format)
    if (!pipeline) {
      let module = modules.get(program.key)
      if (!module)
        modules.set(
          program.key,
          (module = device.createShaderModule({ label: POST_MATERIAL_PASS, code: program.wgsl })),
        )
      pipeline = preparedPipeline(
        device,
        fullscreenDescriptor(
          device,
          module,
          kit.layout,
          POST_MATERIAL_ENTRY,
          [{ format }],
          POST_MATERIAL_PASS,
        ),
      )
      byFormat.set(format, pipeline)
    }
    return pipeline
  }
  /** The pair of targets of each format and extent: locations that differ in either keep their own, so none is made again at each image. */
  const images = new Map<string, { pair: ReturnType<typeof sizedImage>[]; used: number }>()
  /** The count of the calls made; a pair unused for `STALE` calls (an extent the image left) is given back when another is made. */
  let calls = 0
  const draw = fullscreenDraw(POST_MATERIAL_PASS)
  const copyTarget = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
  const copyCanvas = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
  const copyOnly: GPURenderPassDescriptor = {
    label: POST_MATERIAL_PASS,
    colorAttachments: [copyTarget],
  }
  const copyBoth: GPURenderPassDescriptor = {
    label: POST_MATERIAL_PASS,
    colorAttachments: [copyTarget, copyCanvas],
  }
  const copyGroups = createWebgpuBindIdentity()
  let copyGroup: GPUBindGroup | undefined

  const targetsOf = (format: GPUTextureFormat, extentW: number, extentH: number) => {
    const key = `${format} ${extentW}x${extentH}`
    let kept = images.get(key)
    if (!kept) {
      for (const [other, old] of images)
        if (calls - old.used > STALE) {
          for (const image of old.pair) image.release()
          images.delete(other)
        }
      const usage = GPUTextureUsage.RENDER_ATTACHMENT
      const label = `${POST_MATERIAL_PASS} ${key}`
      images.set(
        key,
        (kept = {
          pair: [0, 1].map((at) => sizedImage(device, `${label} ${at}`, format, usage)),
          used: calls,
        }),
      )
    }
    kept.used = calls
    return kept.pair
  }
  const stateOf = (material: Material, nth: number, bytes: number) => {
    let list = states.get(material)
    if (!list) states.set(material, (list = []))
    let state = list[nth]
    if (!state)
      list[nth] = state = {
        view: uniformBlock(device, `${POST_MATERIAL_PASS} view`, POST_VIEW.words * 4),
        given: uniformBlock(device, `${POST_MATERIAL_PASS} given`, bytes),
        givenBytes: bytes,
        identity: createWebgpuBindIdentity(),
        group: undefined,
      }
    else if (state.givenBytes !== bytes) {
      // The graph's shape moved the size of its values: another buffer, another group.
      retire(device, state.given.buffer)
      state.given = uniformBlock(device, `${POST_MATERIAL_PASS} given`, bytes)
      state.givenBytes = bytes
      state.identity.clear()
    }
    return state
  }
  const retireState = (state: MaterialState) => {
    retire(device, state.view.buffer)
    retire(device, state.given.buffer)
  }
  /** Lets go of the states of the materials the image no longer holds. */
  const keep = (alive: readonly { readonly material: Material }[]) => {
    if (states.size <= alive.length) return
    for (const [material, list] of states)
      if (!alive.some((entry) => entry.material === material)) {
        for (const state of list) retireState(state)
        states.delete(material)
      }
  }
  const groupOf = (state: MaterialState, call: PostCall, current: GPUTextureView) => {
    const next = state.identity.next
    next[0] = state.view.buffer
    next[1] = state.given.buffer
    next[2] = current
    next[3] = call.lit
    next[4] = call.depth
    next[5] = call.customDepth
    next[6] = call.customStencil
    // The uniforms and the six images the group names.
    next.length = 7
    if (state.identity.moved() || !state.group)
      state.group = device.createBindGroup({
        label: POST_MATERIAL_PASS,
        layout: kit.layout,
        entries: sequentialEntries([
          { buffer: state.view.buffer },
          { buffer: state.given.buffer },
          current,
          call.lit,
          call.depth,
          call.customDepth ?? kit.noDepth,
          call.customStencil ?? kit.noStencil,
          kit.sampler,
        ]),
      })
    return state.group
  }

  /** Gives the targets back: no material draws. */
  const release = () => {
    for (const { pair } of images.values()) for (const image of pair) image.release()
    images.clear()
  }

  return {
    /**
     * Draws the materials of `call.chain` over `call.input`, each over what the one before wrote, and returns the image after them,
     * `call.input` itself where none drew; `entries` are all the materials the image holds, whose states are kept.
     */
    apply(call: PostCall, entries: readonly { readonly material: Material }[]): GPUTextureView {
      keep(entries)
      calls++
      const [width, height, extentW, extentH] = call.frame.image
      const pair = targetsOf(call.format, extentW, extentH)
      const drawn = new Map<Material, number>()
      let current = call.input
      let written = 0
      for (const { material, weight } of call.chain) {
        const program = usablePostProgram(material)
        if (!program) continue
        const pipeline = pipelineOf(program, call.format).get()
        if (!pipeline) continue
        const place = blendableOf(material)
        const nth = drawn.get(material) ?? 0
        drawn.set(material, nth + 1)
        const state = stateOf(material, nth, program.bytes)
        const stencil =
          place.stencilTest &&
          call.allowStencil &&
          call.stencilAllocated &&
          call.location !== 'sceneColorAfterTonemapping'
        writePostView(state.view.words.f, call.frame, exposureScales(place, call.preExposure))
        writePostGiven(
          state.given.words.u.buffer,
          material,
          place,
          { blend: blendOf(material, place.outputAlpha, call.allowBlend), stencil },
          call.clocks,
          program,
          weight,
        )
        state.view.send()
        state.given.send()
        // The image the material reads is never the one it writes: the first target is the one the input is not.
        const first = pair[0].view(extentW, extentH)
        const target = current === first ? pair[1].view(extentW, extentH) : first
        draw(call.encoder, target, pipeline, groupOf(state, call, current), undefined, [
          width,
          height,
        ])
        current = target
        written++
      }
      return written ? current : call.input
    },
    /** Copies `source`, the image the display chain left, onto the display image and, where given, the canvas it was presented to, over
     *  the first `width × height` pixels. */
    copyOnto(
      encoder: GPUCommandEncoder,
      source: GPUTextureView,
      display: GPUTextureView,
      presentation: GPUTextureView | undefined,
      width: number,
      height: number,
    ) {
      const pipeline = (presentation ? kit.copyPresent : kit.copy).get()
      if (!pipeline) return
      copyGroups.next[0] = source
      if (copyGroups.moved() || !copyGroup)
        copyGroup = device.createBindGroup({
          layout: kit.copyLayout,
          entries: sequentialEntries([source]),
        })
      copyTarget.view = display
      copyCanvas.view = presentation as GPUTextureView
      drawFullscreenTriangle(
        encoder,
        presentation ? copyBoth : copyOnly,
        pipeline,
        copyGroup,
        width,
        height,
      )
    },
    /** Bytes of the targets and uniforms held. */
    get bytes() {
      let bytes = 0
      for (const { pair } of images.values()) for (const image of pair) bytes += image.bytes
      for (const list of states.values())
        for (const state of list) bytes += state.givenBytes + POST_VIEW.words * 4
      return bytes
    },
    release,
    dispose() {
      release()
      for (const list of states.values()) for (const state of list) retireState(state)
      states.clear()
    },
  }
}

/** The post-process materials on a device (`createPostMaterials`). */
export type PostMaterials = ReturnType<typeof createPostMaterials>
