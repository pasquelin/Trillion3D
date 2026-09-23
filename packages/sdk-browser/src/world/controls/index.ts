import { createTransformControls } from './transform.ts';

/** The `controls` family: controllers a page attaches to a world, beside the camera controller
 *  `world.controls` already drives. */
export const controls = {
  /**
   * Handles that move, turn and scale one object with the mouse (`transform.ts`).
   * @param host - The world whose scene and camera the handles live in.
   * @param options - Mode, axes, snapping and screen size; saying nothing is the usual case.
   * @example const gizmo = controls.transform(world).attach(box);
   * gizmo.addEventListener('dragEnd', () => history.push(box.position.clone()));
   */
  transform: createTransformControls,
};

export type {
  TransformControls,
  TransformControlsOptions,
  TransformEvent,
  TransformHost,
} from './transform.ts';
export type {
  TransformHandle,
  TransformMode,
  TransformSnap,
  TransformSpace,
} from './transformMath.ts';
