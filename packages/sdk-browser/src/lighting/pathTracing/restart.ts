import type { SceneMaskPrograms } from '../rays/sceneTrace/sceneMaskPrograms.ts'
import type { PathTracingSettings, PathTracingProgress } from './framePlan.ts'

/**
 * WHEN THE ACCUMULATION STARTS OVER: the settings that change the image (the counts, the light integration, the clamps, the lights' grid, the sampler, adaptive sampling), the size of the view, the
 * scene (its revision), the lights (their epoch), the camera (its world matrix and projection, compared as numbers: the temporal pass's jitter moves neither), the sky light's colour and
 * the exposure by more than a factor of 16 (a smaller change is taken up by the display, which divides by the pre-exposure the accumulation was begun with). The settings of the denoiser, the progress
 * bar and the wiper change nothing a sample holds: they do not restart.
 */
export const PATH_TRACING_RESTART_FIELDS = [
  'pathTracingSamplesPerPixel',
  'pathTracingMaxBounces',
  'pathTracingBackgroundAlpha',
  'pathTracingVisualize',
  'pathTracingVisualizeIncludeTranslucent',
  'pathTracingVisualizeSamplesPerPixel',
  'pathTracingVisualizeMaxCount',
  'pathTracingVisualizeAmbientOcclusionMaxDistance',
  'pathTracingMISMode',
  'pathTracingSamplerType',
  'pathTracingApproximateCaustics',
  'pathTracingMaxPathIntensity',
  'pathTracingEnableEmissive',
  'pathTracingFrameIndependentTemporalSeed',
  'pathTracingMISCompensation',
  'pathTracingSkylightCaching',
  'pathTracingFilterWidth',
  'pathTracingVisibleLights',
  'pathTracingLightGridResolution',
  'pathTracingLightGridMaxCount',
  'pathTracingLightGridAxis',
  'pathTracingExperimental',
  'pathTracingAdaptiveSampling',
  'pathTracingAdaptiveSamplingErrorThreshold',
  'pathTracingEnableReferenceAtmosphere',
  'pathTracingAtmosphereOpticalDepthLUTResolution',
  'pathTracingAtmosphereOpticalDepthLUTNumSamples',
  'pathTracingEnableAtmosphereGround',
  'pathTracingUseAnalyticTransmittance',
  'pathTracingMaxRaymarchSteps',
  'pathTracingVolumeMISMode',
  'pathTracingEnableReferenceClouds',
  'pathTracingCloudAccelerationMapResolution',
  'pathTracingCloudAccelerationMapNumSamples',
  'pathTracingCloudAccelerationMapVisualize',
  'pathTracingCloudMultipleScatterMode',
  'pathTracingCloudRoughnessCutoff',
] as const satisfies readonly (keyof PathTracingSettings)[]

/** What a run was begun with, and what the next image compares itself to. */
export interface PathTracingRun {
  readonly settings: string
  readonly size: readonly [number, number]
  readonly scene: number
  readonly lights: number
  readonly camera: Float64Array
  readonly sky: string
  /** What the rays cut the masked surfaces by: the graph programs of the any-hit test (a set is one array for one content, compared by identity) and the revision of the cutout words (`SceneTrace.cutoutRevision`). */
  readonly cutBy: SceneMaskPrograms
  readonly cutoutRevision: number
  /** The pre-exposure the first sample of the run was gathered under. */
  readonly baseExposure: number
}

/** What an image knows of itself, to compare to the run held. */
export interface PathTracingInputs {
  readonly settings: PathTracingSettings
  readonly size: readonly [number, number]
  readonly scene: number
  readonly lights: number
  readonly camera: ArrayLike<number>
  readonly sky: string
  readonly cutBy: SceneMaskPrograms
  readonly cutoutRevision: number
  readonly exposure: number
}

/** The settings that restart, as one string to compare. */
export const settingsKey = (settings: PathTracingSettings) =>
  PATH_TRACING_RESTART_FIELDS.map((field) => `${settings[field]}`).join('|')

/** The run an image begins. */
export const runOf = (inputs: PathTracingInputs): PathTracingRun => ({
  settings: settingsKey(inputs.settings),
  size: inputs.size,
  scene: inputs.scene,
  lights: inputs.lights,
  camera: Float64Array.from(inputs.camera),
  sky: inputs.sky,
  cutBy: inputs.cutBy,
  cutoutRevision: inputs.cutoutRevision,
  baseExposure: inputs.exposure,
})

/** Why `inputs` do not continue `held`, none when they do: the first word of the reason names what moved. */
export function restartReason(
  held: PathTracingRun | undefined,
  inputs: PathTracingInputs,
): string | undefined {
  if (!held) return 'first image'
  if (held.settings !== settingsKey(inputs.settings)) return 'settings'
  if (held.size[0] !== inputs.size[0] || held.size[1] !== inputs.size[1]) return 'size'
  if (held.scene !== inputs.scene) return 'scene'
  if (held.lights !== inputs.lights) return 'lights'
  if (held.sky !== inputs.sky) return 'sky'
  if (held.cutBy !== inputs.cutBy || held.cutoutRevision !== inputs.cutoutRevision) return 'cutout'
  const high = Math.max(held.baseExposure, inputs.exposure)
  if (high > 16 * Math.min(held.baseExposure, inputs.exposure)) return 'exposure'
  const { camera } = held
  if (camera.length !== inputs.camera.length) return 'camera'
  for (let at = 0; at < camera.length; at++) if (camera[at] !== inputs.camera[at]) return 'camera'
  return undefined
}

/** What the tracer holds of the image before: the sample it is at, the images made in all (`frameIndex`, not reset by a restart: the random sequence goes on with it), the denoiser's
 *  mode when it last ran, (whether a denoised image is held is the denoiser's own state). */
export interface PathTracingCounters extends Omit<PathTracingProgress, 'hasHistory'> {
  frameIndex: number
}

/** The counters at the start of a run: the sample 0, the frame index kept. */
export const restarted = (counters: PathTracingCounters): PathTracingCounters => ({
  iteration: 0,
  frameIndex: counters.frameIndex,
  lastDenoiserMode: counters.lastDenoiserMode,
})

/** The counters after an image: a sample traced counts one, in the sample and in the frame index; the denoiser's mode is the one it ran at. */
export function advanced(
  counters: PathTracingCounters,
  traced: boolean,
  denoiserMode: number,
): PathTracingCounters {
  return {
    iteration: counters.iteration + (traced ? 1 : 0),
    frameIndex: counters.frameIndex + (traced ? 1 : 0),
    lastDenoiserMode: denoiserMode,
  }
}
