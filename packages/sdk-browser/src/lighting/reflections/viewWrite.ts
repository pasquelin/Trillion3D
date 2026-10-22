import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { screenRelativeThickness, screenSlab } from '../../visibility/hiz/gpu/screenSlab.ts'
import type { HeldImage } from './radiance/radiance.ts'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import { gridSide } from './grids.ts'
import {
  REFLECTION_RULES,
  reflectionRingTests,
  reflectionRingWork,
} from '../../../../sdk-core/src/contracts/reflectionOptions.ts'

/** What an image tells its reflection view (`createReflectionViewWriter`). */
export type ReflectionFrame = {
  /** The render view-projection the depth was drawn with, jitter included. */
  viewProjection: ArrayLike<number>
  /** The thickness the reference walk gives a surface, a share of its depth
   *  (`hizRelativeDepthThickness`). */
  relativeThickness: number
  /** The eye, in the world the view-projection takes (`screenSlab`). */
  eye: ArrayLike<number>
  /** The drawn size. */
  size: readonly [number, number]
  /** Whether the depth pyramid holds this image's whole depth. */
  depthDrawn: boolean
  /** Whether this image's trace answers the transparents' front surface (`frontLayer.ts`). */
  front?: boolean
  /** The reflections' turn (`ReflectionView.temporal`). */
  turn?: number
  /** The radiance a ray that leaves the scene reaches (`createSurroundings`): zero when absent. */
  surroundings?: ArrayLike<number>
  /** The iterations of a ray's march of the screen and the steps of its walk of each ring of the scene
   *  (`reflectionScreenSteps`, `reflectionRingSteps`): the settings' defaults when absent. */
  screenSteps?: number
  ringSteps?: number
  /** Whether the scene is traced at all (`screenProbeSceneTraces`, the one switch of the scene trace): true when absent. */
  sceneTraces?: boolean
  /** The pre-exposure this image's light is written multiplied by: the radiance image that is held
   *  keeps it, and the next image divides the light it reads by it (1 when absent). */
  preExposure?: number
}

/**
 * The writer of a view uniform `buffer`: it stages this image's view — the view-projection, the
 * radiance image's view-projection, drawn size and top level (`levels` − 1), the geometry of a
 * surface's thickness (`screenSlab`) with the world size of a
 * pixel at a unit clip `w` — 2 /
 * (height · |row y of the view-projection|), the projection's vertical scale —, whether the screen
 * is traced, whether the trace answers the transparents' front
 * surface, the reflections' turn, the grid's extent, the surroundings and what a ray may spend
 * (`ReflectionView.scene`: the screen march's iterations, a ring's work and triangle tests). The words
 * that differ from those it sent go up (`writeChanged`). Nothing is allocated by a call.
 */
export function createReflectionViewWriter(device: GPUDevice, buffer: GPUBuffer) {
  const staged = new Float32Array(REFLECTION_VIEW_WORDS)
  const words = new Uint32Array(staged.buffer)
  const traced = new Uint32Array(staged.buffer, REFLECTION_VIEW_AT.traced * 4, 4)
  const front = new Uint32Array(staged.buffer, REFLECTION_VIEW_AT.front * 4, 4)
  const temporal = new Uint32Array(staged.buffer, REFLECTION_VIEW_AT.temporal * 4, 4)
  const grid = new Uint32Array(staged.buffer, REFLECTION_VIEW_AT.grid * 4, 4)
  const scene = new Uint32Array(staged.buffer, REFLECTION_VIEW_AT.scene * 4, 4)
  return (frame: ReflectionFrame, held: HeldImage, levels: number) => {
    const m = frame.viewProjection
    copyMatrix4(staged, m, REFLECTION_VIEW_AT.viewProj)
    copyMatrix4(staged, held.viewProjection, REFLECTION_VIEW_AT.radianceViewProj)
    const [, height] = frame.size
    staged[REFLECTION_VIEW_AT.radiance] = held.size[0]
    staged[REFLECTION_VIEW_AT.radiance + 1] = held.size[1]
    staged[REFLECTION_VIEW_AT.radiance + 2] = levels - 1
    staged[REFLECTION_VIEW_AT.radiance + 3] = 1 / held.preExposure
    staged.set(screenSlab(m, height, frame.eye), REFLECTION_VIEW_AT.slab)
    staged[REFLECTION_VIEW_AT.thickness] = screenRelativeThickness(m, frame.relativeThickness)
    traced[0] = frame.depthDrawn && held.valid ? 1 : 0
    front[0] = frame.front ? 1 : 0
    temporal[0] = frame.turn ?? 0
    grid[0] = gridSide(frame.size[0])
    grid[1] = gridSide(frame.size[1])
    const ringSteps = frame.ringSteps ?? REFLECTION_RULES.reflectionRingSteps.default
    scene[0] = frame.screenSteps ?? REFLECTION_RULES.reflectionScreenSteps.default
    scene[1] = reflectionRingWork(ringSteps)
    scene[2] = reflectionRingTests(ringSteps)
    scene[3] = frame.sceneTraces === false ? 0 : 1
    if (frame.surroundings) staged.set(frame.surroundings, REFLECTION_VIEW_AT.surroundings)
    else staged.fill(0, REFLECTION_VIEW_AT.surroundings, REFLECTION_VIEW_AT.surroundings + 4)
    writeChanged(device, buffer, words, 0, REFLECTION_VIEW_WORDS)
  }
}
