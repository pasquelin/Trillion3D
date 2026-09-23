/**
 * What `world.controls` keeps and drives: the settings it hands to every controller it makes,
 * and the shape of those controllers as it sees them.
 */
import { HEAD_DEFAULTS } from '../../camera/controls/look.ts';
import { FLY_DEFAULTS } from '../../camera/controls/flyControls.ts';
import { ORBIT_DEFAULTS } from '../../camera/controls/orbitControls.ts';
import { HUMAN_BODY } from '../../../../sdk-core/src/collision/characterSettings.ts';
import type { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import type { worldControls } from './worldCamera.ts';

/** The limits and speeds the handle keeps for its controller, at the controllers' own defaults. */
export const CONTROL_SETTINGS = {
  minDistance: 0,
  maxDistance: Infinity,
  ...ORBIT_DEFAULTS,
  movementSpeed: 1,
  ...HEAD_DEFAULTS,
  ...FLY_DEFAULTS,
  rotateSpeed: 1,
  zoomSpeed: 1,
  ...HUMAN_BODY,
  onLand: null as ((impact: number) => void) | null,
  onJump: null as (() => void) | null,
};
export type ControlSetting = keyof typeof CONTROL_SETTINGS;

/** A controller as the world drives it: a pivot one carries a `target`, a steered one integrates
 *  over a delta in `update`. */
export type Controller = NonNullable<ReturnType<typeof worldControls>> & {
  target?: Vector3;
  update?: (delta?: number) => boolean;
};
