import { joined } from '../../../../sdk-core/src/runtime/joined.ts'
import type { WorldTarget } from './target.ts'
import { registerWorld } from './session.ts'
import type { WorldOptions } from './options.ts'
import { noticeEffectBudget } from '../../diagnostic/world/worldNotices.ts'
import { noVehicle } from './controls/controlTargets.ts'
import { worldParts } from './worldParts.ts'
import { worldView, worldViewMethods } from './worldView.ts'
import { worldSettings } from './worldSettings.ts'
import { worldImageSettings, worldSceneSettings } from './worldFamilySettings.ts'
import { worldMethods } from './worldMethods.ts'

/** Creates a world: the scene, camera, engine and loop of one view, on its own WebGPU device.
 * @param target - The canvas to draw into, an element to draw inside, or the ID of either.
 * @param options - How the world draws and listens; saying nothing is the normal case.
 * @example const world = createWorld('viewer', { controls: 'orbit' });
 * await world.scene.load('/cache/city/manifest.json'); */
export function createWorld(target: WorldTarget, options: WorldOptions = {}) {
  if (options.controls === 'vehicle') throw noVehicle()
  const parts = worldParts(target, options)
  const { canvas, frames, diagnostic, runtime, switches } = parts
  const world = joined(
    worldView(parts),
    worldSettings(parts),
    worldSceneSettings(parts),
    worldImageSettings(parts),
    worldMethods(parts),
    worldViewMethods(parts),
  )
  parts.modules.bind(world)
  frames.add(noticeEffectBudget(world.budget, canvas, world.effects, diagnostic.notices))
  registerWorld(world, { session: () => runtime.explorer, last: () => frames.last }, switches.held)
  return world
}

/** What `createWorld` returns: one view. */ export type World = ReturnType<typeof createWorld>
