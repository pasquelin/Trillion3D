import { Vector3 } from '../../../../../sdk-core/src/world/math/vector3.ts'
import { joined } from '../../../../../sdk-core/src/runtime/joined.ts'
import { worldControls, type WorldControls } from '../camera.ts'
import type { Camera } from '../../../../../sdk-core/src/world/camera/camera.ts'
import { CONTROL_SETTINGS, type ControlSetting, type Controller } from './controlsSettings.ts'
import { controlSettingAccessors, type ControlSettings } from './controlsAccessors.ts'
import type { CharacterSettings } from '../characterAccessors.ts'
import { controlTargets, noVehicle, type CharacterSource } from './controlTargets.ts'

/** The controller in place and how it is steered: which kind, whether it listens. */
type ControlState = { kind: WorldControls; enabled: boolean; current: Controller | null }

/** Whether the controller in place moves on its own — cruising, a stick input held, a turn —
 *  and so is sent its first frame; the ones after follow from its own `change`. */
const wake = (state: ControlState, invalidate: () => void, live: Record<string, unknown>) => {
  const moving = live.autoForward === true || live.pitchInput || live.yawInput || live.rollInput
  if (state.enabled && (moving || live.autoRotate)) invalidate()
}

/** The settings kept, handed on to the controller in place and to each one `kind` makes, and the
 *  controller made again. */
function controllerSlot(
  state: ControlState,
  camera: () => Camera,
  surface: HTMLElement,
  invalidate: () => void,
  bindTargets: (live: Record<string, unknown> | null) => void,
  standingTarget: Vector3,
  settings: Record<ControlSetting, unknown>,
) {
  /** Hands every kept setting to the controller in place, where it has them. */
  const bound = () => {
    const live = state.current as Record<string, unknown> | null
    if (!live) return
    for (const name of Object.keys(settings) as ControlSetting[])
      if (name in live) live[name] = settings[name]
    bindTargets(live)
    wake(state, invalidate, live)
  }
  const setting = <K extends ControlSetting>(name: K, value: (typeof CONTROL_SETTINGS)[K]) => {
    settings[name] = value
    const live = state.current as Record<string, unknown> | null
    if (live && name in live) {
      live[name] = value
      wake(state, invalidate, live)
    }
    // A pivot controller re-reads its pose under the new setting, and redraws if it moved.
    if (state.enabled && state.current?.target) state.current.update?.()
  }
  const rebuild = () => {
    standingTarget.copy(state.current?.target ?? standingTarget)
    state.current?.dispose()
    state.current = worldControls(state.kind, camera(), surface) as Controller | null
    state.current?.pause(!state.enabled)
    bound()
    if (state.current?.target) {
      state.current.target.copy(standingTarget)
      if (state.enabled) state.current.update?.()
    }
    state.current?.addEventListener('change', invalidate)
  }
  return { setting, rebuild }
}

/** The handle's own members: the controller's kind, whether it listens, its target, its step. */
function steering(
  state: ControlState,
  standingTarget: Vector3,
  rebuild: () => void,
  invalidate: () => void,
  hasVehicle: () => boolean,
) {
  return {
    /** Which controller steers the camera; set another name to switch. */
    get kind() {
      return state.kind
    },
    set kind(next: WorldControls) {
      if (next === 'vehicle' && !hasVehicle()) throw noVehicle()
      state.kind = next
      rebuild()
    },
    /**
     * Whether the controller listens to the mouse and keyboard and moves the camera. `false`
     * pauses it — no input, no `update` — without remaking it: velocity, footing, stride,
     * orientation and turn are kept, and `true` resumes exactly where it stopped.
     */
    get enabled() {
      return state.enabled
    },
    set enabled(on: boolean) {
      if (on === state.enabled) return
      state.enabled = on
      state.current?.pause(!on)
      if (on) invalidate()
    },
    /** The point a pivot controller turns around. */
    get target(): Vector3 {
      return state.current?.target ?? standingTarget
    },
    /** Whether the world's loop calls `update` ahead of each frame, before `world.beforeFrame`
     *  hooks. `false` hands the step to the page, which calls `update` from such a hook, as
     *  often and over whatever sub-steps it integrates; the world then never steps it. */
    autoUpdate: true,
    /** Integrates a steered controller over `delta` seconds; a pivot one re-reads its pose,
     *  and an orbit turns by `autoRotate`. A paused controller does nothing. */
    update(delta = 0) {
      if (!state.enabled) return
      state.current?.update?.(delta)
    },
    /** The world's camera changed: the controller follows it. */
    follow: rebuild,
    /** Stops the controller and removes its listeners from the canvas. */
    dispose() {
      state.current?.dispose()
      state.current = null
    },
  }
}

/** The character's readings of the controller in place; zero for any other. */
const characterReads = (state: ControlState) => ({
  /** Character only: the body's velocity in metres per second, a copy; zero otherwise. */
  get velocity(): Vector3 {
    const v = (state.current as { velocity?: ArrayLike<number> } | null)?.velocity
    return v ? new Vector3(v[0], v[1], v[2]) : new Vector3()
  },
  /** Character only: whether the feet are on a floor; `false` for any other controller. */
  get onGround(): boolean {
    return (state.current as { onGround?: boolean } | null)?.onGround === true
  },
  /** Character only: the stride's phase in radians, a foot striking at 0 and π; 0 otherwise. */
  get stride(): number {
    return (state.current as { stride?: number } | null)?.stride ?? 0
  },
})

/**
 * `world.controls`: the controller driving the world's camera from the canvas, live. Changing
 * `kind` releases the one in place and makes the next; `enabled` pauses it; a gesture redraws.
 *
 * THE LIMITS AND SPEEDS BELONG TO THE HANDLE, not to the controller in place: a write is kept,
 * handed to the live controller when it has that setting, and handed again to every controller
 * `kind` makes later. A controller without that setting ignores it — the distances bound the
 * pivot controllers (orbit, trackball, pan-zoom), the angles and `autoRotate` the orbit alone;
 * `movementSpeed` drives flight and first person, `lookSpeed` those two and the character,
 * `minPitch` and `maxPitch` first person and the character, the turn speeds, the stick inputs,
 * `inputResponse`, `autoForward` and `pointerLook` flight, `rotateSpeed` and `zoomSpeed` the pivot controllers, the body,
 * speeds, jump and hooks the character — so a page may set them before or after it picks its
 * controller. The character's body is Jolt's, in the world's physics, and meets the
 * simulation's bodies (`physics` below); until the physics runs it stands where it was put. A cruising flight or a turning orbit moves on every frame, so the
 * handle asks for the first one; a paused controller, or any other kind, leaves the scene
 * still.
 */
export function worldControlsHandle(
  initial: WorldControls,
  camera: () => Camera,
  surface: HTMLElement,
  invalidate: () => void,
  physics: CharacterSource | null = null,
) {
  const state: ControlState = { kind: initial, enabled: true, current: null }
  const standingTarget = new Vector3(),
    settings = { ...CONTROL_SETTINGS }
  const { setting, rebuild } = controllerSlot(
    state,
    camera,
    surface,
    invalidate,
    (live) => targets.bind(live),
    standingTarget,
    settings,
  )
  const rebind = () => {
    targets.bind(state.current as Record<string, unknown> | null)
    invalidate()
  }
  const targets = controlTargets(physics, rebind, () => state.kind === 'vehicle')
  // The world's physics started or stopped: the character's body follows it.
  physics?.watch(rebind)
  rebuild()
  const hasVehicle = () => !!targets.accessors.vehicle
  const handle = steering(state, standingTarget, rebuild, invalidate, hasVehicle)
  // The settings are accessors of their own module; they join the handle as accessors, live.
  type Kept = ControlSettings & CharacterSettings & typeof targets.accessors
  return joined(
    handle,
    controlSettingAccessors(settings, setting),
    targets.accessors,
    characterReads(state),
  ) as typeof handle & Kept & ReturnType<typeof characterReads>
}
