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
import { airHeld, airTraced } from './airDepth.ts'
import { pathTracingOn } from './enabled.ts'
import { drawPathTracingDisplay } from './display.ts'
import { encodePathTracingImage } from './encodeImage.ts'
import {
  fittedToDevice,
  planPathTracingFrame,
  visualizedSettings,
  type PathTracingSettings,
} from './framePlan.ts'
import {
  PathTracingGpu,
  airBytesOf,
  lightRoom,
  pathTracingBytes,
  tileSideOf,
  tilesOf,
  volumeTablesBytes,
} from './gpuState.ts'
import { encodeErrorMips, encodeNormalSpace } from './imageStages.ts'
import { buildPathTracingLights } from './lightRecords.ts'
import { skyTableSize } from './skyWgsl.ts'
import { createPathTracingGroups, hitShadeResolveEntries } from './encodeGroups.ts'
import { hitPlacementsOf } from './hitPlacements.ts'
import {
  admitCloudMap,
  cloudRefusalHolds,
  cloudShadowLightsOf,
  cloudsAtTime,
  cloudsKey,
  tracedCloudsOf,
  type CloudMapRefusal,
} from './cloudFrame.ts'
import {
  finishStageOf,
  pathTracingCloudPipelinesOf,
  pathTracingPipelinesOf,
  volumeStagesOf,
  type PathTracingPipelines,
} from './pipelines.ts'
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
import { denoisePipelinesOf } from './denoisePipelines.ts'
import { drawDenoiseViews } from './drawDenoiseViews.ts'
import {
  denoiseGpuOf,
  denoiseNeedsOf,
  encodeDenoise,
  forgetDenoiseHistory,
  newDenoiseState,
  releaseDenoise,
  type DenoiseState,
} from './encodeDenoise.ts'

/** What the path tracer keeps of a runtime between images. */
interface PathTracingState {
  gpu?: PathTracingGpu
  gpuKey: string
  /** The key the budget refused and the room it had then: the allocation is asked again only when either moved. */
  refused?: { key: string; room: number }
  /** The clouds' map the budget refused: the run traces no clouds until the setting's side moves or the room grows past what the map asks. */
  cloudsRefused?: CloudMapRefusal
  /** The bytes the budget was asked for the tracer's resources, but for its volume tables (`PathTracingGpu.volumeBytes`). */
  bytes: number
  blocks?: PathTracingBlocks
  run?: PathTracingRun
  counters: PathTracingCounters
  /** The lights of the run: how many (the records themselves are on the GPU). */
  lightCount: number
  /** Whether a restart's lights are still to be encoded (their grid, the view of the payload, the sky's table): an image that left before encoding them leaves them to the next that traces. */
  lightsPending: boolean
  /** Whether a restart's table of placements is still to be written: an image that left before writing it leaves it to the next that gets so far. */
  placementsPending: boolean
  /** Whether the next image still has samples to gather or a denoiser to run: a quiet view is drawn again while it does. */
  accumulating: boolean
  /** The clouds' time the run was begun at: the paths of a run all see the clouds of one instant, or the accumulation would smear them (the reference's restart holds no time and its clouds smear). */
  cloudTime?: number
  /** The image of the ping-pong that holds the latest accumulation, none before the first sample of the run. */
  latest: 0 | 1 | undefined
  groups?: ReturnType<typeof createPathTracingGroups>
  groupsDevice?: GPUDevice
  /** The class keys the hits of the scene are shaded as, and the entries of the resolve's group the shade keeps. */
  classes: ReadonlySet<number>
  /** The rounds a bounce takes after its own, as the scene's surfaces ask (`HitPlacements.passRounds`). */
  passRounds: number
  resolve?: GPUBindGroupEntry[]
  /** The denoiser's resources and history. */
  denoise: DenoiseState
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
        counters: { iteration: 0, frameIndex: 0, lastDenoiserMode: 1 },
        lightCount: 0,
        lightsPending: false,
        placementsPending: false,
        accumulating: false,
        latest: undefined,
        classes: new Set(),
        passRounds: 0,
        denoise: newDenoiseState(),
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
  const held = states.get(rt)
  held?.gpu?.destroy()
  if (held) releaseDenoise(held.denoise)
  states.delete(rt)
}

/** The tiles, the bounce levels and the room each of the resources needs, as one key: a view whose key moved is made again. */
function resourcesOf(
  device: GPUDevice,
  settings: PathTracingSettings,
  size: readonly [number, number],
  lightCount: number,
  skySize: number,
  airHeld: boolean,
) {
  const tile = tileSideOf(device, settings.pathTracingDispatchSize)
  const tiles = tilesOf(size, tile)
  const bounces = settings.pathTracingMaxBounces
  const capacity = lightRoom(lightCount)
  const grid = clampLowWins(settings.pathTracingLightGridMaxCount, 1, capacity)
  const resolution = nextPow2(settings.pathTracingLightGridResolution)
  const sky = skySize === 0 ? 2 : skyTableSize(skySize, device.limits.maxTextureDimension2D)
  // The held air's table and its parameters are made as the settings ask, so the table's side is part of the key and of what the ledger is asked for. The clouds' map is made again in place and admitted on its own (`admitCloudMap`; its bytes follow the tables, `PathTracingGpu.volumeBytes`), so that the clouds' textures arriving, or a refusal of the map, does not make the view again.
  const airSide = airHeld ? settings.pathTracingAtmosphereOpticalDepthLUTResolution : 0
  const tables = airBytesOf(airSide)
  const key = [size, tile, bounces, capacity, grid, resolution, sky, airSide].join('|')
  return { tile, tiles, depth: bounces, capacity, grid, resolution, sky, tables, airSide, key }
}

/** The pipelines an image waits for: every one it runs, the table of the air only where the air is traced and the map of the clouds only where the clouds are. */
const readyStagesOf = (
  pipelines: PathTracingPipelines,
  settings: PathTracingSettings,
  air: boolean,
  clouds: unknown,
) => [
  ...pipelines.all,
  finishStageOf(pipelines, settings.pathTracingVisualize),
  ...volumeStagesOf(pipelines, air, !!clouds),
]

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
  const shade = hitShadePipelinesOf(device)

  const state = stateOf(rt)
  // Resources made on another device are of no use to this one.
  if (state.gpu && state.gpu.device !== device) {
    state.gpu.destroy()
    state.gpu = undefined
    state.gpuKey = ''
    state.refused = undefined
    state.cloudsRefused = undefined
  }
  const settings = fittedToDevice(
    visualizedSettings(pathTracingSettingsOf(rt)),
    device.limits.maxTextureDimension2D,
  )
  const size: [number, number] = [targets.targetSize[0], targets.targetSize[1]]
  const { store } = rt.lights
  // The traced air stands for the sky: the sky light's cube is no light of the tracer then, or the sky would be counted twice. A view of the payload only suspends it: its table and the clouds' map stay built (and counted).
  const held = airHeld(settings, store.atmospherePacked)
  const air = airTraced(settings, store.atmospherePacked)
  const skyReady = skyLightReady(skyLightStateOf(rt))
  const sky = skyReady && !air
  const room = resourcesOf(
    device,
    settings,
    size,
    store.count + 1,
    // The table is built at the cube's size whenever the sky is ready, not only while the sky is traced: a view of the payload suspends the traced air and lights the sky through it, and must neither read a 2x2 table nor remake the resources.
    skyReady ? 2 ** skyLightStateOf(rt).uniform[5]! : 0,
    held,
  )
  // The resources are admitted first, then the clouds' map on them: a refusal of either is known before the clouds, the pipelines and the run's inputs are chosen, and the image goes on without what was refused.
  if (room.key !== state.gpuKey) {
    if (state.refused?.key === room.key && state.refused.room === ledgerRoom(device))
      return undefined
    const levels = room.depth + 2
    const blockCount = room.tiles.length * levels * PT_STEPS
    const old = state.gpu
    const ledgerHeld = old && {
      bytes: state.bytes + old.volumeBytes(),
      dispose: () => old.destroy(),
    }
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
      room.tables,
    )
    const admitted = ledgerAdmitted(device, {
      held: ledgerHeld,
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
          room.airSide,
        ),
    })
    if (!admitted.value) {
      state.refused = { key: room.key, room: ledgerRoom(device) }
      return undefined
    }
    state.refused = undefined
    state.gpu = admitted.value
    state.bytes = asked - room.tables
    state.blocks = createBlocks(blockCount)
    state.gpuKey = room.key
    // The run starts over on the new resources, without the history of the denoiser they replace.
    state.run = undefined
    forgetDenoiseHistory(state.denoise)
  }
  const gpu = state.gpu!
  // The clouds the paths march are those of the sky's clouds part, over the traced air; their code is compiled into the trace and the finish only then. The map is made again in place when its side moved: the budget admits it as it does the tracer's resources, and refuses it softly, the image going on without clouds; it is given back whenever the clouds are no more wanted (a view of the payload only suspends them).
  const cloudSide = settings.pathTracingCloudAccelerationMapResolution
  const wanted = tracedCloudsOf(rt, device, settings, held)
  const refused = wanted && cloudRefusalHolds(state.cloudsRefused, cloudSide, ledgerRoom(device))
  const mapped = !!wanted && !refused && admitCloudMap(device, gpu, cloudSide)
  if (mapped) state.cloudsRefused = undefined
  else {
    gpu.releaseCloudMap()
    if (wanted && !refused)
      state.cloudsRefused = {
        side: cloudSide,
        room: ledgerRoom(device),
        missing: volumeTablesBytes(0, cloudSide),
      }
  }
  const clouds = mapped && air ? wanted : undefined
  const pipelines = clouds ? pathTracingCloudPipelinesOf(device) : pathTracingPipelinesOf(device)
  if (!chainReady(...readyStagesOf(pipelines, settings, air, clouds))) return undefined
  const inputs: PathTracingInputs = {
    settings,
    size,
    scene: rt.run.gate.revisions.scene,
    lights: store.epoch,
    camera: [...cam.world, ...cam.projection],
    sky: `${sky ? skyLightStateOf(rt).uniform.join(',') : 'none'}|${air ? store.atmosphereVersion : 0}|${cloudsKey(clouds)}`,
    exposure: preExposureOf(rt).now,
  }
  const reason = restartReason(state.run, inputs)
  if (reason) {
    state.run = runOf(inputs)
    // The denoised history outlives a restart only where the temporal denoiser is set to run at every image, and not a change of the view's size.
    const keepHistory = settings.pathTracingTemporalDenoiserMode === 2 && reason !== 'size'
    if (!keepHistory) forgetDenoiseHistory(state.denoise)
    state.counters = restarted(state.counters)
    state.latest = undefined
    // Raised as soon as the restart is accepted: an early return below must not lose what this restart owes.
    state.lightsPending = true
    state.placementsPending = true
  }
  if (!clouds) state.cloudTime = undefined
  else if (reason || state.cloudTime === undefined) state.cloudTime = clouds.time
  const run = state.run!
  const counters = state.counters
  const denoiser =
    settings.pathTracingDenoiser && chainReady(...denoisePipelinesOf(device).all)
      ? denoiseGpuOf(device, state.denoise, size, denoiseNeedsOf(settings))
      : undefined
  const planned = denoiser ? settings : { ...settings, pathTracingDenoiser: false }
  const frame = planPathTracingFrame(
    planned,
    { ...counters, hasHistory: state.denoise.last !== undefined },
    size,
  )
  if (state.groupsDevice !== device) {
    state.groups = createPathTracingGroups()
    state.groupsDevice = device
  }
  // The records of the surfaces go up before the group names their texture.
  rt.vis.materialTable.viewFor(device)
  state.resolve ??= hitShadeResolveEntries(shadeBindEntries(shadeResources(rt)))
  if (!entriesReady(state.resolve)) return undefined
  const eye: [number, number, number] = [cam.eye[0]!, cam.eye[1]!, cam.eye[2]!]
  const lights = state.lightsPending
    ? buildPathTracingLights(
        store,
        eye,
        !!sky,
        air ? store.atmospherePacked : undefined,
        cloudShadowLightsOf(store),
      )
    : undefined
  if (lights) {
    writeLights(device, gpu, lights)
    state.lightCount = lights.count
  }
  if (state.placementsPending) {
    state.placementsPending = false
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
    air: { packed: store.atmospherePacked, version: store.atmosphereVersion },
    clouds: cloudsAtTime(clouds, state.cloudTime),
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
  state.lightsPending = false
  if (traced !== undefined) state.latest = traced
  // The air's optical depth table is made over several images: the view is drawn again until it is whole.
  if (air && gpu.airDepthBuilding !== '' && gpu.airDepthKey !== gpu.airDepthBuilding)
    state.accumulating = true
  const image = state.latest
  if (image === undefined) return undefined
  if (frame.adaptive && traced !== undefined)
    encodeErrorMips(device, encoder, pipelines, gpu, image)
  if (frame.stages.includes('normalSpace'))
    encodeNormalSpace(device, encoder, pipelines, gpu, image, cam.world)
  const denoised = denoiser
    ? encodeDenoise({
        device,
        encoder,
        pipelines: denoisePipelinesOf(device),
        gpu,
        dgpu: denoiser,
        state: state.denoise,
        settings,
        frame,
        iteration: counters.iteration,
        image,
        exposure: preExposureOf(rt).now / run.baseExposure,
      })
    : undefined
  // The display counts the sample just traced itself (its shader adds one to the sample it is given), as the reference passes the index before it moves.
  const display = {
    iteration: counters.iteration,
    baseExposure: run.baseExposure,
    preExposure: preExposureOf(rt).now,
    image,
    shown: denoised?.shown,
  }
  state.counters = advanced(counters, traced !== undefined, planned.pathTracingDenoiser ? 1 : 0)
  state.accumulating = frame.needsMoreRays || frame.denoise
  return {
    wiper: settings.pathTracingWiperMode,
    draw: (target, depth) => {
      drawPathTracingDisplay(device, encoder, pipelines, gpu, settings, display, target, depth)
      if (denoised?.views && denoiser)
        drawDenoiseViews(
          device,
          encoder,
          denoisePipelinesOf(device),
          denoiser,
          settings,
          denoised.views,
          display.preExposure / display.baseExposure,
          target,
        )
    },
  }
}
