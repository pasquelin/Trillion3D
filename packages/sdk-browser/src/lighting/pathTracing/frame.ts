import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import {
  PATH_TRACING_RULES,
  readPathTracingSetting,
} from '../../../../sdk-core/src/contracts/pathTracingOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { viewProj } from '../../frame/backend/helpers.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  skyLightPending,
  skyLightReadOf,
  skyLightReady,
  skyLightStateOf,
} from '../../frame/render/skyLightState.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { ledgerAdmitted, ledgerRoom } from '../../gpu/core/deviceLedger.ts'
import { chainReady } from '../deferred/fullscreen.ts'
import { entriesReady } from '../../gpu/bind/bindIdentity.ts'
import { shadeBindEntries } from '../../gpu/bind/bindEntries.ts'
import { shadeResources } from '../../gpu/bind/shadeBindings.ts'
import { sceneRaysOf } from '../surfaceCache/lighting/surfaceLighting.ts'
import { createBlocks, type PathTracingBlocks } from './blocks.ts'
import { PT_STEPS } from './viewWgsl.ts'
import { pathTracingOn } from './enabled.ts'
import { drawPathTracingDisplay } from './display.ts'
import { encodePathTracingImage } from './encodeImage.ts'
import { planPathTracingFrame, type PathTracingSettings } from './framePlan.ts'
import { PathTracingGpu, lightRoom, pathTracingBytes, tileSideOf, tilesOf } from './gpuState.ts'
import { encodeErrorMips, encodeNormalSpace } from './imageStages.ts'
import { buildPathTracingLights } from './lightRecords.ts'
import { skyTableSize } from './skyWgsl.ts'
import { createPathTracingGroups, hitShadeResolveEntries } from './encodeGroups.ts'
import { hitPlacementsOf } from './hitPlacements.ts'
import { pathTracingPipelinesOf } from './pipelines.ts'
import { hitShadePipelinesOf } from './shadeHitPipelines.ts'
import {
  advanced,
  restartReason,
  restarted,
  runOf,
  type PathTracingCounters,
  type PathTracingInputs,
  type PathTracingRun,
} from './restart.ts'
import { writeLights } from './tables.ts'

/** What the path tracer keeps of a runtime between images. */
interface PathTracingState {
  gpu?: PathTracingGpu
  gpuKey: string
  /** The key the budget refused and the room it had then: the allocation is asked again only when either moved. */
  refused?: { key: string; room: number }
  /** The bytes the budget was asked for the tracer's resources. */
  bytes: number
  blocks?: PathTracingBlocks
  run?: PathTracingRun
  counters: PathTracingCounters
  /** The lights of the run: how many (the records themselves are on the GPU). */
  lightCount: number
  /** Whether the next image still has samples to gather or a denoiser to run: a quiet view is drawn again while it does. */
  accumulating: boolean
  /** The image of the ping-pong that holds the latest accumulation, none before the first sample of the run. */
  latest: 0 | 1 | undefined
  groups?: ReturnType<typeof createPathTracingGroups>
  groupsDevice?: GPUDevice
  /** The class keys the hits of the scene are shaded as, and the entries of the resolve's group the shade keeps. */
  classes: ReadonlySet<number>
  /** The rounds a bounce takes after its own, as the scene's surfaces ask (`HitPlacements.passRounds`). */
  passRounds: number
  resolve?: GPUBindGroupEntry[]
}

const states = new WeakMap<WebgpuPagesRuntime, PathTracingState>()

function stateOf(rt: WebgpuPagesRuntime): PathTracingState {
  let state = states.get(rt)
  if (!state)
    states.set(
      rt,
      (state = {
        gpuKey: '',
        bytes: 0,
        counters: { iteration: 0, frameIndex: 0, lastDenoiserMode: 1, hasHistory: false },
        lightCount: 0,
        accumulating: false,
        latest: undefined,
        classes: new Set(),
        passRounds: 0,
      }),
    )
  return state
}

/** The path tracer's settings of `rt`, each as resolved. */
export function pathTracingSettingsOf(rt: WebgpuPagesRuntime) {
  const settings: Record<string, unknown> = {}
  for (const field of Object.keys(PATH_TRACING_RULES) as (keyof typeof PATH_TRACING_RULES)[])
    settings[field] = readPathTracingSetting(rt, field)
  return settings as PathTracingSettings
}

/** Whether a quiet view is drawn again for the path tracer: it has samples left to gather or a denoiser to run, or has yet to draw its first image. */
export function pathTracingAccumulating(rt: WebgpuPagesRuntime) {
  if (!pathTracingOn(rt)) return false
  const state = states.get(rt)
  return !state?.run || state.accumulating
}

/** Lets the path tracer's resources go: the view is no more drawn by it. */
export function releasePathTracing(rt: WebgpuPagesRuntime) {
  states.get(rt)?.gpu?.destroy()
  states.delete(rt)
}

/** The tiles, the bounce levels and the room each of the resources needs, as one key: a view whose key moved is made again. */
function resourcesOf(
  device: GPUDevice,
  settings: PathTracingSettings,
  size: readonly [number, number],
  lightCount: number,
  skySize: number,
) {
  const tile = tileSideOf(device, settings.pathTracingDispatchSize)
  const tiles = tilesOf(size, tile)
  const bounces = settings.pathTracingMaxBounces
  const capacity = lightRoom(lightCount)
  const grid = clampLowWins(settings.pathTracingLightGridMaxCount, 1, capacity)
  const resolution = nextPow2(settings.pathTracingLightGridResolution)
  const sky = skySize === 0 ? 2 : skyTableSize(skySize, device.limits.maxTextureDimension2D)
  const key = [size, tile, bounces, capacity, grid, resolution, sky].join('|')
  return { tile, tiles, depth: bounces, capacity, grid, resolution, sky, key }
}

/** What a path-traced image leaves for the lit image to be drawn with. */
export interface PathTracedImage {
  /** Whether only the right of the view is the tracer's, the frame's own lighting drawn first (`pathTracingWiperMode`). */
  readonly wiper: boolean
  /** Draws the tracer's image into `target`, the lit image, and its depth into `depth`, the frame's, on the encoder it was prepared on. */
  draw(target: GPUTextureView, depth: GPUTextureView): void
}

/**
 * THE IMAGE OF A PATH-TRACED VIEW, its work encoded on `encoder` in the order `planPathTracingFrame` gives: at a restart (the first image, a change of the settings, the size, the scene, the lights, the sky,
 * the camera or the exposure, `restartReason`) the lights' records, the light grid and the sky's table; the sample, traced bounce by bounce and accumulated, with the error chain after it where adaptive
 * sampling is on; the normals in the camera's space where the denoiser asks them. Returns how to draw the result once the lit image is drawn, or nothing — the normal lighting then draws —
 * while the view is not path traced, the scene trace the rays go through is not made for this image, the sky is not ready, or a pipeline is still compiling.
 */
export function preparePathTracing(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
): PathTracedImage | undefined {
  if (!pathTracingOn(rt)) {
    releasePathTracing(rt)
    return undefined
  }
  const { gpu: targets } = rt
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  const { hdrView } = targets
  if (!hdrView || !rays || skyLightPending(rt)) return undefined
  const pipelines = pathTracingPipelinesOf(device)
  if (!chainReady(...pipelines.all)) return undefined
  const shade = hitShadePipelinesOf(device)

  const state = stateOf(rt)
  const settings = pathTracingSettingsOf(rt)
  const size: [number, number] = [targets.targetSize[0], targets.targetSize[1]]
  const { store } = rt.lights
  const sky = skyLightReady(skyLightStateOf(rt))
  const room = resourcesOf(
    device,
    settings,
    size,
    store.count + 1,
    sky ? 2 ** skyLightStateOf(rt).uniform[5]! : 0,
  )
  const inputs: PathTracingInputs = {
    settings,
    size,
    scene: rt.run.gate.revisions.scene,
    lights: store.epoch,
    camera: [...cam.world, ...cam.projection],
    sky: sky ? skyLightStateOf(rt).uniform.join(',') : 'none',
    exposure: preExposureOf(rt).now,
  }
  // Resources made on another device are of no use to this one.
  if (state.gpu && state.gpu.device !== device) {
    state.gpu.destroy()
    state.gpu = undefined
    state.gpuKey = ''
    state.refused = undefined
  }
  const reason = room.key !== state.gpuKey ? 'resources' : restartReason(state.run, inputs)
  if (reason) {
    if (room.key !== state.gpuKey) {
      if (state.refused?.key === room.key && state.refused.room === ledgerRoom(device))
        return undefined
      const levels = room.depth + 2
      const blockCount = room.tiles.length * levels * PT_STEPS
      const old = state.gpu
      const held = old && { bytes: state.bytes, dispose: () => old.destroy() }
      state.gpu = undefined
      state.gpuKey = ''
      const asked = pathTracingBytes(
        size,
        room.tile,
        levels,
        blockCount,
        room.resolution,
        room.capacity,
        room.grid,
        room.sky,
      )
      const admitted = ledgerAdmitted(device, {
        held,
        asked,
        what: 'the path tracer',
        make: () =>
          new PathTracingGpu(
            device,
            size,
            room.tile,
            levels,
            blockCount,
            room.resolution,
            room.capacity,
            room.grid,
            room.sky,
          ),
      })
      if (!admitted.value) {
        state.refused = { key: room.key, room: ledgerRoom(device) }
        return undefined
      }
      state.refused = undefined
      state.gpu = admitted.value
      state.bytes = asked
      state.blocks = createBlocks(blockCount)
      state.gpuKey = room.key
    }
    state.run = runOf(inputs)
    state.counters = restarted(state.counters)
    state.latest = undefined
  }
  const gpu = state.gpu!
  const run = state.run!
  const counters = state.counters
  const frame = planPathTracingFrame(settings, counters, size)
  if (state.groupsDevice !== device) {
    state.groups = createPathTracingGroups()
    state.groupsDevice = device
  }
  // The records of the surfaces go up before the group names their texture.
  rt.vis.materialTable.viewFor(device)
  state.resolve ??= hitShadeResolveEntries(shadeBindEntries(shadeResources(rt)))
  if (!entriesReady(state.resolve)) return undefined
  const eye: [number, number, number] = [cam.eye[0]!, cam.eye[1]!, cam.eye[2]!]
  const lights = reason ? buildPathTracingLights(store, eye, !!sky) : undefined
  if (lights) {
    writeLights(device, gpu, lights)
    state.lightCount = lights.count
  }
  if (reason) {
    const placed = hitPlacementsOf(rt)
    gpu.writePlacements(placed.words)
    state.classes = placed.classes
    state.passRounds = placed.passRounds
  }
  if (!chainReady(...[...state.classes].map((key) => shade.of(key)))) return undefined
  const viewInverse = new Float64Array(16)
  invertMatrix4(viewInverse, viewProj)
  const traced = encodePathTracingImage({
    device,
    encoder,
    pipelines,
    gpu,
    settings,
    frame,
    counters,
    baseExposure: run.baseExposure,
    blocks: state.blocks!,
    tiles: room.tiles,
    depth: room.depth,
    lights,
    lightCount: state.lightCount,
    sky: sky ? skyLightReadOf(rt) : undefined,
    rays,
    groups: state.groups!,
    resolve: state.resolve,
    shade,
    classes: state.classes,
    passRounds: state.passRounds,
    viewInverse,
    viewProjection: viewProj,
    eye,
    size,
    latest: state.latest,
  })
  if (traced !== undefined) state.latest = traced
  const image = state.latest
  if (image === undefined) return undefined
  if (frame.adaptive && traced !== undefined)
    encodeErrorMips(device, encoder, pipelines, gpu, image)
  if (frame.stages.includes('normalSpace'))
    encodeNormalSpace(device, encoder, pipelines, gpu, image, cam.world)
  // The display counts the sample just traced itself (its shader adds one to the sample it is given), as the reference passes the index before it moves.
  const display = {
    iteration: counters.iteration,
    baseExposure: run.baseExposure,
    preExposure: preExposureOf(rt).now,
    image,
  }
  state.counters = advanced(counters, traced !== undefined, settings.pathTracingDenoiser ? 1 : 0)
  state.accumulating = frame.needsMoreRays || frame.denoise
  return {
    wiper: settings.pathTracingWiperMode,
    draw: (target, depth) =>
      drawPathTracingDisplay(device, encoder, pipelines, gpu, settings, display, target, depth),
  }
}
