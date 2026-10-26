import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts'
import type { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import { trackTransformDrag } from './transformDrag.ts'
import { buildTransformHandles } from './transformHandles.ts'
import { handleScreenSize } from './transformView.ts'
import { createListeners, type Listeners } from '../../../../sdk-core/src/runtime/listeners.ts'
import type {
  DragStart,
  TransformHandle,
  TransformMode,
  TransformSnap,
  TransformSpace,
} from './transformMath.ts'
import type { CanvasPoint, RaycastOptions } from '../../session/world/raycast.ts'
import type { Intersection } from '../../api/query/types.ts'

/** What a transform control needs of a world: `createWorld` returns one. */
export type TransformHost = {
  /** The canvas the pointer presses on. */
  readonly canvas: HTMLCanvasElement
  /** The scene the handles are added to. */
  readonly scene: Object3D
  /** The camera the canvas is seen through. */
  readonly camera: Camera
  /** Runs `hook` after each frame drawn; returns what stops it. */
  onFrame(hook: () => void): () => void
  /** The nearest thing a canvas point meets, answered a frame or so later (`world.raycast`): the
   *  hover the handles are picked by. */
  raycast(at: CanvasPoint, options: RaycastOptions): Promise<Intersection | null>
}

/** What `controls.transform` may be told; every field is optional. */
export interface TransformControlsOptions {
  /** Move, turn or scale; `'translate'` by default. */
  mode?: TransformMode
  /** Handles along the world axes or the object's own; `'world'` by default. */
  space?: TransformSpace
  /** Steps each drag is rounded to; none by default. */
  snap?: TransformSnap
  /** The handles' length as a share of the canvas height, the same wherever the object stands; a quarter by default. */
  size?: number
}

/** The events a transform control emits: every pose it writes, and the start and end of a drag. */
export type TransformEvent = 'change' | 'dragStart' | 'dragEnd'

/** What `controls.transform` returns: the handles, the object they are on and what a drag does. */
export interface TransformControls {
  /** Steps drags are rounded to: `{ translate, rotate, scale }`, each optional. */
  snap: TransformSnap
  /** The group of the handles — a `helper` mark — in the scene while attached. */
  readonly handles: Object3D
  /** The object the handles are on, or `null`. */
  readonly object: Object3D | null
  /** True while a handle is being dragged. */
  readonly dragging: boolean
  /** What a drag does: `'translate'`, `'rotate'` or `'scale'`. */
  readonly mode: TransformMode
  /** `'world'` or `'local'` axes. */
  readonly space: TransformSpace
  /** Puts the handles on `target`, and in the scene; a drag under way ends first (`dragEnd`).
   *  @param target - The object to move. */
  attach(target: Object3D): TransformControls
  /** Takes the handles off their object, and out of the scene; a drag under way ends first. */
  detach(): TransformControls
  /** Moves, turns or scales from now on. @param next - The mode. */
  setMode(next: TransformMode): TransformControls
  /** Handles along the world's axes or the object's own. @param next - The space. */
  setSpace(next: TransformSpace): TransformControls
  /** Calls `listener` on each event of `type`. */
  addEventListener(type: TransformEvent, listener: () => void): void
  /** Stops calling `listener` on events of `type`. */
  removeEventListener(type: TransformEvent, listener: () => void): void
  /** Takes the handles out of the scene and every listener off the canvas. */
  dispose(): void
}

/** The object the handles are on, what a drag does and the axes it reads. */
type TransformState = { object: Object3D | null; mode: TransformMode; space: TransformSpace }

/** The listeners of each event, and how a page hears them. */
function createTransformEvents() {
  const heard: Record<TransformEvent, Listeners> = {
    change: createListeners(),
    dragStart: createListeners(),
    dragEnd: createListeners(),
  }
  return {
    emit: (type: TransformEvent) => heard[type].emit(),
    addEventListener: (type: TransformEvent, listener: () => void) =>
      void heard[type].subscribe(listener),
    removeEventListener: (type: TransformEvent, listener: () => void) =>
      void heard[type].unsubscribe(listener),
    clear() {
      for (const listeners of Object.values(heard)) listeners.clear()
    },
  }
}

/** How the handles sit on the object as the camera sees it now, and where a drag starts from. */
function createHandleFit(
  host: TransformHost,
  parts: ReturnType<typeof buildTransformHandles>,
  state: TransformState,
  size: number,
) {
  const { root } = parts
  const at = new Vector3(),
    turn = new Quaternion(),
    stretch = new Vector3(),
    still = new Quaternion()
  return {
    /** Places, turns and sizes the handles on the object as the camera sees it now. */
    fit() {
      const { object, mode, space } = state
      if (!object) return
      object.updateWorldMatrix(true, false)
      object.matrixWorld.decompose(at, turn, stretch)
      root.position.copy(at)
      root.quaternion.copy(space === 'local' || mode === 'scale' ? turn : still)
      const scale = handleScreenSize(host.camera, at, size)
      root.scale.set(scale, scale, scale)
      for (const name in parts.groups) {
        const group = parts.groups[name as TransformMode]
        if (group.visible !== (name === mode)) group.visible = name === mode
      }
    },
    // `press` fits the handles first: `at` and `turn` are the object's world pose now.
    start(handle: TransformHandle, from: Ray): DragStart {
      const { object, mode, space } = state
      const pose = { position: at.clone(), quaternion: turn.clone(), scale: object!.scale.clone() }
      const up = new Vector3(0, 1, 0).applyQuaternion(host.camera.getWorldQuaternion(still.clone()))
      const view = from.direction.clone()
      return { ...pose, mode, handle, space, from, view, up, reach: root.scale.x }
    },
  }
}

/** What puts the handles on an object, takes them off and changes what a drag does; each gives
 *  back the control `self` names. */
function createTransformActions(
  held: {
    host: TransformHost
    root: Object3D
    state: TransformState
    fit: () => void
    drag: ReturnType<typeof trackTransformDrag>
  },
  self: () => TransformControls,
) {
  const { host, root, state, fit, drag } = held
  return {
    attach(target: Object3D) {
      if (target !== state.object) drag.end()
      state.object = target
      if (root.parent !== host.scene) host.scene.add(root)
      fit()
      return self()
    },
    detach() {
      drag.end()
      state.object = null
      root.removeFromParent()
      return self()
    },
    setMode(next: TransformMode) {
      state.mode = next
      fit()
      return self()
    },
    setSpace(next: TransformSpace) {
      state.space = next
      fit()
      return self()
    },
  }
}

/**
 * A transform control: handles on one object that move, turn or scale it with the mouse, in the
 * world's or the object's own axes, rounded to `snap`. The handles are scene meshes (`helper`
 * marks, `transformHandles.ts`) kept at one screen size; a press is picked on them by the world's
 * ray query, hovered as the pointer moves (`transformDrag.ts`), before the camera controller hears
 * it, so an orbit rests while a handle is dragged and resumes after, with no page code. A drag
 * writes the object's local pose from the world pose it asks for, through its parents. Nothing runs
 * between frames: the handles, and the hover under a still pointer, follow the view after a frame
 * the world drew, and a still scene draws none.
 */
export function createTransformControls(
  host: TransformHost,
  options: TransformControlsOptions = {},
): TransformControls {
  const parts = buildTransformHandles()
  const { root } = parts
  const events = createTransformEvents()
  const state: TransformState = {
    object: null,
    mode: options.mode ?? 'translate',
    space: options.space ?? 'world',
  }
  const { fit, start } = createHandleFit(host, parts, state, options.size ?? 1 / 4)
  const drag = trackTransformDrag(host, parts, {
    object: () => state.object,
    start,
    snap: () => controls.snap,
    fit,
    emit: events.emit,
  })
  const actions = createTransformActions({ host, root, state, fit, drag }, () => controls)
  const unhook = host.onFrame(() => {
    fit()
    drag.follow()
  })
  const controls: TransformControls = {
    snap: { ...options.snap },
    handles: root,
    get object() {
      return state.object
    },
    get dragging() {
      return drag.dragging()
    },
    get mode() {
      return state.mode
    },
    get space() {
      return state.space
    },
    ...actions,
    addEventListener: events.addEventListener,
    removeEventListener: events.removeEventListener,
    dispose() {
      controls.detach()
      unhook()
      drag.dispose()
      events.clear()
    },
  }
  return controls
}
