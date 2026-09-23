/**
 * A road wheel as spec parts — tyre, dished rim, spokes, hub, brake disc — every part with the
 * role `wheel` and its anchor index, so the page spins them together about the axle (X).
 */
import type { Vec3 } from '../plan/contract.ts';
import type { VehiclePart, WheelAnchor } from './vehicle-spec.ts';

/** Surfaces a wheel reads from its spec: `tyre`, `rim`, `trim`. */
export function wheelParts(wheel: WheelAnchor, anchor: number, spokes = 5): VehiclePart[] {
  const {
      position: [x, y, z],
      radius: r,
      width: w,
    } = wheel,
    side = x >= 0 ? 1 : -1,
    // Lathe axis Y turned onto X, the profile's +Y facing out of the car.
    axle: Vec3 = [0, 0, -side * (Math.PI / 2)],
    rim = r * 0.64,
    common = { role: 'wheel' as const, anchor };
  return [
    {
      shape: 'torus',
      size: [2 * r, w, 2 * r],
      position: wheel.position,
      rotation: [0, 0, Math.PI / 2],
      surface: 'tyre',
      segments: 48,
      ...common,
    },
    {
      shape: 'lathe',
      size: [1, 1, 1],
      profile: [
        [0.03, -w * 0.3],
        [rim * 0.35, -w * 0.32],
        [rim * 0.97, -w * 0.42],
        [rim, -w * 0.3],
        [rim * 1.02, w * 0.3],
        [rim * 0.92, w * 0.38],
        [rim * 0.3, w * 0.12],
        [0.02, w * 0.14],
      ],
      position: wheel.position,
      rotation: axle,
      surface: 'rim',
      segments: 40,
      ...common,
    },
    {
      shape: 'rounded-box',
      size: [0.035, rim * 0.72, rim * 0.22],
      position: [x + side * w * 0.2, y + rim * 0.52, z],
      surface: 'rim',
      bevel: 0.012,
      segments: 2,
      repeat: {
        count: spokes,
        turn: { axis: 'x', pivot: wheel.position, angle: (2 * Math.PI) / spokes },
      },
      ...common,
    },
    {
      shape: 'cylinder',
      size: [rim * 0.36, 0.05, rim * 0.36],
      position: [x + side * w * 0.22, y, z],
      rotation: axle,
      surface: 'trim',
      segments: 24,
      ...common,
    },
    {
      shape: 'cylinder',
      size: [r * 1.1, 0.03, r * 1.1],
      position: [x - side * w * 0.1, y, z],
      rotation: axle,
      surface: 'trim',
      segments: 32,
      ...common,
    },
  ];
}
