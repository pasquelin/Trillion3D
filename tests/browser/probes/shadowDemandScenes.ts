/**
 * The two moving scenes of the demand probe (`shadow-demand-reads-gpu.ts`, #1275), frame by frame:
 * `spin-an-astrolabe` — a still lamp inside a ring that turns round it, its inner side lit — and
 * `a-ring-of-lamps` — eight lamps circling over a floor wider than their range —, each with its
 * view, its lights and the points its pixels light.
 */
import type { SceneLight, ShadowViewpoint } from '../../../packages/sdk-core/src/index.ts';
import {
  LAMP,
  VIEW,
} from '../../../packages/sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';

/** A lit point: where it lies, its normal. */
export type LitPoint = { P: number[]; N: number[] };

export interface DemandScene {
  name: string;
  view: ShadowViewpoint;
  lights: (frame: number) => SceneLight[];
  lits: (frame: number) => LitPoint[];
}

type Vec3 = [number, number, number];
const unit = (v: number[]) => v.map((c) => c / Math.hypot(...v)) as Vec3;

/** Whether `P` lies inside the field of `view`, a forward with no roll. */
function inView(view: ShadowViewpoint, P: number[]) {
  const f = view.forward,
    d = P.map((c, a) => c - view.position[a]),
    right = unit([-f[2], 0, f[0]]),
    up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1]];
  const along = d[0] * f[0] + d[1] * f[1] + d[2] * f[2],
    t = Math.tan(view.halfFovY);
  const side = (axis: number[]) => Math.abs(d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]);
  return along > view.near && side(up) <= t * along && side(right) <= t * view.aspect * along;
}

const AT: Vec3 = [0, 3, -12],
  R = 2.2;
/** A still lamp at the centre of a ring 2.2 m across that turns a tenth of a radian a frame, seen
 *  from 5.6 m on a 2,234-pixel-high canvas: 360 points of its inner side. */
export const ASTROLABE: DemandScene = {
  name: 'spin-an-astrolabe',
  view: { ...VIEW, position: [0, 3, -6.4], pixelNear: (VIEW.pixelNear * 720) / 2234 },
  lights: () => [{ ...LAMP, position: AT, range: 10 }],
  lits: (frame) =>
    Array.from({ length: 360 }, (_, i) => {
      const a = (i / 360) * 2 * Math.PI,
        turn = frame / 10;
      const offset = [
        R * Math.cos(a) * Math.cos(turn),
        R * Math.sin(a),
        R * Math.cos(a) * Math.sin(turn),
      ];
      return { P: offset.map((c, k) => AT[k] + c), N: offset.map((c) => -c / R) };
    }),
};

const RING_VIEW: ShadowViewpoint = {
  ...VIEW,
  position: [0, 7, 9.5],
  forward: unit([0, -7, -9.5]),
  halfFovY: (25 * Math.PI) / 180,
  aspect: 1728 / 1117,
  pixelNear: (0.1 * 2 * Math.tan((25 * Math.PI) / 180)) / 2234,
};
/** The top of the ring's 16 m floor the view holds, every 25 cm. */
const floor: LitPoint[] = [];
for (let x = -8; x <= 8; x += 0.25)
  for (let z = -8; z <= 8; z += 0.25)
    if (inView(RING_VIEW, [x, 0, z])) floor.push({ P: [x, 0, z], N: [0, 1, 0] });
/** Eight lamps of range 6 on a 2.5 m orbit, 2.5 m up, turning a twentieth of a radian a frame. */
export const LAMP_RING: DemandScene = {
  name: 'a-ring-of-lamps',
  view: RING_VIEW,
  lights: (frame) =>
    Array.from({ length: 8 }, (_, k) => {
      const a = (k * Math.PI) / 4 + frame / 20;
      return {
        ...LAMP,
        id: `lamp ${k}`,
        position: [2.5 * Math.cos(a), 2.5, 2.5 * Math.sin(a)] as Vec3,
        range: 6,
      };
    }),
  lits: () => floor,
};
