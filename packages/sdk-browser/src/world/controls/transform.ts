import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts';
import { trackTransformDrag } from './transformDrag.ts';
import { buildTransformHandles } from './transformHandles.ts';
import { handleScreenSize } from './transformView.ts';
import type { TransformMode, TransformSnap, TransformSpace } from './transformMath.ts';

/** What a transform control needs of a world: `createWorld` returns one. */
export type TransformHost = {
  /** The canvas the pointer presses on. */
  readonly canvas: HTMLElement;
  /** The scene the handles are added to. */
  readonly scene: Object3D;
  /** The camera the canvas is seen through. */
  readonly camera: Camera;
  /** Runs `hook` after each frame drawn; returns what stops it. */
  onFrame(hook: () => void): () => void;
};

/** What `controls.transform` may be told; every field is optional. */
export interface TransformControlsOptions {
  /** Move, turn or scale; `'translate'` by default. */
  mode?: TransformMode;
  /** Handles along the world axes or the object's own; `'world'` by default. */
  space?: TransformSpace;
  /** Steps each drag is rounded to; none by default. */
  snap?: TransformSnap;
  /** The handles' length as a share of the canvas height, the same wherever the object stands; a quarter by default. */
  size?: number;
}

/** The events a transform control emits: every pose it writes, and the start and end of a drag. */
export type TransformEvent = 'change' | 'dragStart' | 'dragEnd';

/**
 * A transform control: handles on one object that move, turn or scale it with the mouse, in the
 * world's or the object's own axes, rounded to `snap`. The handles are scene meshes (`helper`
 * marks, `transformHandles.ts`) kept at one screen size; a press is picked on them with the CPU
 * raycast, before the camera controller hears it, so an orbit rests while a handle is dragged and
 * resumes after, with no page code. A drag writes the object's local pose from the world pose it
 * asks for, through its parents. Nothing runs between frames: the handles follow the view after
 * a frame the world drew, and a still scene draws none.
 */
export function createTransformControls(
  host: TransformHost,
  options: TransformControlsOptions = {},
) {
  const parts = buildTransformHandles();
  const { root } = parts;
  const heard: Record<TransformEvent, Set<() => void>> = {
    change: new Set(),
    dragStart: new Set(),
    dragEnd: new Set(),
  };
  const emit = (type: TransformEvent) => heard[type].forEach((listener) => listener());
  let object: Object3D | null = null,
    mode = options.mode ?? 'translate',
    space = options.space ?? 'world';
  const size = options.size ?? 1 / 4;
  const at = new Vector3(),
    turn = new Quaternion(),
    stretch = new Vector3(),
    still = new Quaternion();
  /** Places, turns and sizes the handles on the object as the camera sees it now. */
  const fit = () => {
    if (!object) return;
    object.updateWorldMatrix(true, false);
    object.matrixWorld.decompose(at, turn, stretch);
    root.position.copy(at);
    root.quaternion.copy(space === 'local' || mode === 'scale' ? turn : still);
    const scale = handleScreenSize(host.camera, at, host.canvas, size);
    root.scale.set(scale, scale, scale);
    for (const [name, group] of Object.entries(parts.groups))
      if (group.visible !== (name === mode)) group.visible = name === mode;
  };
  const unhook = host.onFrame(fit);
  const drag = trackTransformDrag(host, parts, {
    object: () => object,
    start: (handle, from) => {
      object!.updateWorldMatrix(true, false);
      object!.matrixWorld.decompose(at, turn, stretch);
      const pose = { position: at.clone(), quaternion: turn.clone(), scale: object!.scale.clone() };
      return { ...pose, mode, handle, space, from, view: from.direction.clone() };
    },
    snap: () => controls.snap,
    fit,
    emit,
  });
  const controls = {
    /** Steps drags are rounded to: `{ translate, rotate, scale }`, each optional. */
    snap: { ...options.snap } as TransformSnap,
    /** The object the handles are on, or `null`. */
    get object() {
      return object;
    },
    /** True while a handle is being dragged. */
    get dragging() {
      return drag.dragging();
    },
    /** What a drag does: `'translate'`, `'rotate'` or `'scale'`. */
    get mode() {
      return mode;
    },
    /** `'world'` or `'local'` axes. */
    get space() {
      return space;
    },
    /** Puts the handles on `target`, and in the scene. @param target - The object to move. */
    attach(target: Object3D) {
      object = target;
      if (root.parent !== host.scene) host.scene.add(root);
      fit();
      return controls;
    },
    /** Takes the handles off their object, and out of the scene. */
    detach() {
      object = null;
      root.removeFromParent();
      return controls;
    },
    /** Moves, turns or scales from now on. @param next - The mode. */
    setMode(next: TransformMode) {
      mode = next;
      fit();
      return controls;
    },
    /** Handles along the world's axes or the object's own. @param next - The space. */
    setSpace(next: TransformSpace) {
      space = next;
      fit();
      return controls;
    },
    /** Calls `listener` on each event of `type`. */
    addEventListener(type: TransformEvent, listener: () => void) {
      heard[type].add(listener);
    },
    /** Stops calling `listener` on events of `type`. */
    removeEventListener(type: TransformEvent, listener: () => void) {
      heard[type].delete(listener);
    },
    /** Takes the handles out of the scene and every listener off the canvas. */
    dispose() {
      controls.detach();
      unhook();
      drag.dispose();
      for (const set of Object.values(heard)) set.clear();
    },
  };
  return controls;
}

/** What `controls.transform` returns. */
export type TransformControls = ReturnType<typeof createTransformControls>;
