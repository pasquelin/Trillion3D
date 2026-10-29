import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import {
  reflectionCaptureSide,
  type ReflectionCaptureSettings,
} from '../../../../sdk-core/src/contracts/reflectionCaptureOptions.ts'
import type { ResolvedReflectionCapture } from '../../../../sdk-core/src/scene/reflectionCapture/contracts.ts'
import type { ViewOverrides } from '../../frame/backend/state/viewOverrides.ts'
import { faceViewCamera, type SceneCaptureHost } from '../../modules/sky/skyLight/captureScene.ts'
import {
  createFilterStage,
  filter,
  mipChain,
  type FilterStage,
} from '../../modules/sky/skyLight/captureFilter.ts'
import { writeBlock } from '../../modules/sky/skyLight/captureInputs.ts'
import { BLOCK_STRIDE, CUBE_FACES, groupsOver } from '../../modules/sky/skyLight/layout.ts'
import { holdReflectionCaptureRead, reflectionCaptureStandInCube } from './captureRead.ts'
import { CAPTURE_COPY_LAYOUT } from './captureWgsl.ts'
import {
  MAX_REFLECTION_CAPTURES,
  CAPTURE_BLOCK_WORDS,
  CAPTURE_DIFFUSE_RESULT_MIPS,
  CAPTURE_HEADER_WORDS,
  CAPTURE_RECORD_WORDS,
} from './layout.ts'
import { createReflectionCapturePipelines } from './pipelines.ts'
import { packReflectionCaptures, reflectionCaptureSorted } from './records.ts'
import {
  captureEye,
  captureKey,
  lookAtCaptures,
  recaptureAll,
  type CaptureHeld,
} from './schedule.ts'
import { createCaptureTargets, type CaptureTargets } from './targets.ts'

/**
 * THE REFLECTION CAPTURES OF A SCENE, made and kept: each captured from its point by drawing the scene aside through the six faces of a
 * cube (`captureHdrViews`, the sky light's own way of capturing a scene), the faces copied with the alpha the sky light's distance threshold gives
 * them (`copyCaptureFaceMain`), the mips made and the cube filtered by roughness with the sky light's programs, into the layer of the capture
 * in one cube array; with the diffuse light on, its four smallest mips then hold the capture's diffuse light, summed into harmonics and
 * evaluated, or convolved exhaustively. The records of the captures that are made are written, in the order they are composited, for the lighting
 * to read (`read`). Captures are made between two frames, one at a time, as the sky light's scene is: `due` looks at the scene's captures once
 * a frame, `run` draws the first that is due, `recapture` asks every one again.
 */

/** The overrides of the views a capture draws: lit by the scene's lights and the sky light, every surface rough, no traced reflection, no
 *  particle nor light shaft; the light functions where the setting says. */
const captureOverrides = (settings: ReflectionCaptureSettings): ViewOverrides => ({
  skyLighting: true,
  lighting: true,
  reflections: false,
  roughness: { min: 1, range: 0 },
  particles: false,
  lightShafts: false,
  lightFunctions: settings.reflectionCaptureLightFunctions,
  post: false,
  staticSceneOnly: false,
  lodScale: 1,
  reflectionCapture: true,
})

/** What `run` is told besides the host: the scene's captures, the settings, and the distance in metres past which the capture holds the sky
 *  (the sky light's threshold) where a sky light that is not static shines, else none. */
export interface CaptureRun {
  /** The store's revision: the records are written again when it moves. */
  readonly revision: number
  readonly captures: readonly ResolvedReflectionCapture[]
  readonly settings: ReflectionCaptureSettings
  readonly skyDistance?: number
}

export function createReflectionCaptures(device: GPUDevice, failed: (error: unknown) => void) {
  const own = createReflectionCapturePipelines(device, failed)
  const stage: FilterStage = createFilterStage(device, own.cube.pipelines)
  const held = new Map<string, CaptureHeld>()
  const sampler = postSamplers(device)
  const block = device.createBuffer({
    label: 'Trillion3D reflection capture records',
    size: CAPTURE_BLOCK_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Float32Array(CAPTURE_BLOCK_WORDS)
  const copyWords = new Float32Array(CAPTURE_COPY_LAYOUT.words)
  const copyUints = new Uint32Array(copyWords.buffer)
  const noDepth = device.createTexture({
    label: 'Trillion3D reflection capture no depth',
    size: { width: 1, height: 1 },
    format: 'depth32float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  let targets: CaptureTargets | undefined
  /** The set the lighting reads: the cube array, the sampler and the records. */
  const hold = (cube: GPUTextureView) =>
    holdReflectionCaptureRead(device, { cube, sampler: sampler.mipped, block })
  hold(reflectionCaptureStandInCube(device))
  let running = false
  /** Set by `dispose`: a capture still drawing leaves the buffers it freed alone. */
  let disposed = false
  /** What the records were last written for: the store's revision and `version`, which moves when a capture is made or lost. */
  let written = ''
  let version = 0
  /** The last look at the captures, and how many it found due. */
  let looked = ''
  let dueCount = 0
  let latest: CaptureRun | undefined
  const capacity = () =>
    Math.max(
      1,
      Math.min(
        MAX_REFLECTION_CAPTURES,
        Math.floor(device.limits.maxTextureArrayLayers / CUBE_FACES),
      ),
    )
  const ready = () =>
    [own.copy, own.sh, own.reference, own.halve, ...Object.values(own.cube.pipelines)].every(
      (p) => p.ready,
    )

  /** The cube array made for the settings' side and the captures' number, or made again when either changed. */
  function targetsFor(side: number, count: number) {
    const room = Math.min(capacity(), Math.max(count, 1))
    if (targets && targets.side === side && targets.capacity >= room) return targets
    targets?.destroy()
    for (const h of held.values()) ((h.key = ''), (h.done = false))
    version++
    targets = createCaptureTargets(device, own, side, Math.max(room, targets?.capacity ?? 0))
    hold(targets.cubes)
    return targets
  }

  /** Writes the records of the captures that are made, in their compositing order, once their set or their numbers changed. */
  function writeRecords(run: CaptureRun) {
    const diffuseOn =
      run.settings.reflectionCaptureDiffuse &&
      run.captures.every(
        (c) =>
          !held.get(c.id)?.done ||
          held.get(c.id)!.key === captureKey(c, run.settings, run.skyDistance),
      )
    const key = `${run.revision}|${version}|${diffuseOn}`
    if (key === written) return
    written = key
    const made = reflectionCaptureSorted(run.captures.filter((c) => held.get(c.id)?.done))
    const layers = new Map([...held].map(([id, h]) => [id, h.layer]))
    packReflectionCaptures(words, made, layers, (targets?.mips ?? 1) - 1, diffuseOn)
    device.queue.writeBuffer(
      block,
      0,
      words.buffer,
      0,
      (CAPTURE_HEADER_WORDS + made.length * CAPTURE_RECORD_WORDS) * 4,
    )
  }

  /** The face copy: a face of the captured cube written from the lit image, its alpha from the depth. */
  function copyFace(
    encoder: GPUCommandEncoder,
    t: CaptureTargets,
    lit: GPUTextureView,
    depth: GPUTextureView | undefined,
    drawn: readonly number[],
    allocated: readonly number[],
    face: number,
    run: CaptureRun,
  ) {
    const near = run.settings.reflectionCaptureNearPlane
    const fade = run.skyDistance !== undefined && depth !== undefined
    copyUints.set([fade ? 1 : 0, 0, 0, 0], CAPTURE_COPY_LAYOUT.at.flags)
    copyWords.set([near, run.skyDistance ?? 0, 1 / t.side, 0], CAPTURE_COPY_LAYOUT.at.depth)
    copyWords.set(
      [drawn[0] / allocated[0], drawn[1] / allocated[1], 1, 1],
      CAPTURE_COPY_LAYOUT.at.image,
    )
    const offset = face * BLOCK_STRIDE
    writeBlock(device, t.blocks.copy, offset, copyWords)
    drawFullscreenTriangle(
      encoder,
      {
        label: 'Trillion3D reflection capture copy',
        colorAttachments: [
          {
            view: t.faceTargets[face],
            loadOp: 'clear',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: 'store',
          },
        ],
      },
      own.copy.get(),
      [
        device.createBindGroup({
          layout: own.layouts.scene,
          entries: [
            { binding: 0, resource: lit },
            { binding: 1, resource: sampler.clamped },
            { binding: 2, resource: depth ?? noDepth.createView() },
          ],
        }),
        device.createBindGroup({
          layout: own.layouts.copy,
          entries: [
            {
              binding: 0,
              resource: { buffer: t.blocks.copy, size: CAPTURE_COPY_LAYOUT.words * 4 },
            },
          ],
        }),
      ],
      undefined,
      undefined,
      [offset],
    )
  }

  /** The diffuse light of capture layer `layer` into the small mips of its cube: the exhaustive convolution, convolved into the temporary
   *  cube, halved and copied into the mips, or the harmonics of the cube evaluated into the mips. */
  function diffuse(
    encoder: GPUCommandEncoder,
    t: CaptureTargets,
    layer: number,
    reference: boolean,
  ) {
    const pass = encoder.beginComputePass({ label: 'Trillion3D reflection capture diffuse' })
    const run = (pipeline: GPUComputePipeline | undefined, group: GPUBindGroup, side: number) => {
      if (!pipeline) return
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(groupsOver(side), groupsOver(side), CUBE_FACES)
    }
    if (reference) {
      run(own.reference.get(), t.groups.reference, 1 << (t.resultMips.length - 1))
      t.groups.halve.forEach((group, k) =>
        run(own.halve.get(), group, 1 << (t.resultMips.length - 2 - k)),
      )
      pass.end()
      for (const l of t.resultMips) {
        // Temporary mip `m` is the cube of 8 >> m texels, the capture's mip `mips - 4 + m` when it has four small ones.
        const m = t.resultMips.length - 1 - l
        encoder.copyTextureToTexture(
          { texture: t.temporary, mipLevel: m },
          {
            texture: t.filtered,
            mipLevel: t.mips - 1 - l,
            origin: { x: 0, y: 0, z: layer * CUBE_FACES },
          },
          { width: 1 << l, height: 1 << l, depthOrArrayLayers: CUBE_FACES },
        )
      }
      return
    }
    const sums = own.cube.pipelines.capturedIrradiance.get()
    if (sums) {
      pass.setPipeline(sums)
      pass.setBindGroup(0, t.groups.harmonics)
      pass.dispatchWorkgroups(1)
    }
    t.resultMips.forEach((l) => run(own.sh.get(), t.groups.sh[layer][l], 1 << l))
    pass.end()
  }

  /** The mips, the filter and the diffuse light of the captured cube into capture layer `layer`, in one submit. */
  function finish(t: CaptureTargets, layer: number, run: CaptureRun) {
    const encoder = device.createCommandEncoder({ label: 'Trillion3D reflection capture' })
    stage.slot = 0
    stage.steps.begin(encoder)
    mipChain(stage, t)
    filter(stage, t, layer, 0, t.mips - 1, 0, CUBE_FACES)
    stage.steps.end()
    if (
      run.settings.reflectionCaptureDiffuse &&
      t.resultMips.length === CAPTURE_DIFFUSE_RESULT_MIPS
    )
      diffuse(encoder, t, layer, run.settings.reflectionCaptureDiffuseReference)
    device.queue.submit([encoder.finish()])
  }

  /** A capture the engine could not start yet is asked again at the next look. */
  const retryable = (error: unknown) =>
    error instanceof Error && /^(SURFACE_CAPTURE_BUSY|CAPTURE_NOT_READY)/.test(error.message)

  async function capture(host: SceneCaptureHost, c: ResolvedReflectionCapture, run: CaptureRun) {
    const side = reflectionCaptureSide(run.settings)
    const t = targets!
    const at = held.get(c.id)!
    const eye = captureEye(c)
    const near = run.settings.reflectionCaptureNearPlane
    const key = captureKey(c, run.settings, run.skyDistance)
    try {
      await host.captureHdrViews({
        size: side * run.settings.reflectionCaptureSupersample,
        cameras: Array.from({ length: CUBE_FACES }, (_, face) => faceViewCamera(face, eye, near)),
        overrides: captureOverrides(run.settings),
        copy: (encoder, lit, drawn, allocated, face, depth) => {
          if (!disposed) copyFace(encoder, t, lit, depth, drawn, allocated, face, run)
        },
      })
      // The cube array was made again while the faces were drawn: this capture's layer is another's now.
      if (!disposed && targets === t && held.get(c.id) === at) {
        finish(t, at.layer, run)
        at.key = key
        at.done = true
        version++
      }
    } catch (error) {
      if (!retryable(error)) {
        at.key = key
        version++
        failed(error)
      }
    }
  }

  return {
    /** How many captures are made and read. */
    get made() {
      return [...held.values()].filter((h) => h.done).length
    },
    /** Looks at the scene's captures, once a frame: the cube array made for them, the layers given, and the records written for the ones
     *  made. True when a capture is due now. */
    due(next: CaptureRun) {
      latest = next
      if (!next.settings.reflectionCaptures || next.captures.length === 0) {
        if (held.size) (held.clear(), version++)
        writeRecords(next)
        return false
      }
      // Nothing moved since the last look: the same captures are due.
      const look = `${next.revision}|${version}|${JSON.stringify(next.settings)}|${next.skyDistance}`
      if (look !== looked) {
        looked = look
        const t = targetsFor(reflectionCaptureSide(next.settings), next.captures.length)
        dueCount = lookAtCaptures(
          held,
          next.captures,
          next.settings,
          t.capacity,
          next.skyDistance,
        ).length
        writeRecords(next)
      }
      return !running && dueCount > 0 && ready()
    },
    /** Draws the first capture that is due, aside, and makes its cube; awaited after the frame is submitted. */
    async run(host: SceneCaptureHost) {
      if (!latest || running) return
      const next = latest
      const first = next.captures.find(
        (c) =>
          held.has(c.id) && held.get(c.id)!.key !== captureKey(c, next.settings, next.skyDistance),
      )
      if (!first || !targets) return
      running = true
      try {
        await capture(host, first, next)
        // The records follow the captures as they are now, not as they were when this one started.
        if (!disposed) writeRecords(latest ?? next)
      } finally {
        running = false
      }
    },
    /** Asks every capture again at the next look. */
    recapture: () => (recaptureAll(held), version++),
    dispose() {
      disposed = true
      holdReflectionCaptureRead(device, undefined)
      targets?.destroy()
      targets = undefined
      held.clear()
      noDepth.destroy()
      block.destroy()
    },
  }
}

/** What `createReflectionCaptures` made. */
export type ReflectionCaptures = ReturnType<typeof createReflectionCaptures>
