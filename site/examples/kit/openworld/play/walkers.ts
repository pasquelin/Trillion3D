import { axisAngle, yawPitchRoll } from './math3.ts';
import type { Engine, Node3 } from './types.ts';

/**
 * Pedestrians' bodies: rigid parts hung on joints (hips and shoulders), swung by the stride phase
 * the simulation sends, since the engine cannot deform a skinned mesh.
 * Waiting on the engine: skinning.
 */
export type Figure = { root: Node3; legs: [Node3, Node3]; arms: [Node3, Node3] };

const SHIRTS: [number, number, number][] = [
  [0.6, 0.1, 0.1],
  [0.1, 0.25, 0.55],
  [0.85, 0.75, 0.3],
  [0.15, 0.4, 0.2],
  [0.8, 0.8, 0.78],
  [0.35, 0.2, 0.45],
];
const TROUSERS: [number, number, number][] = [
  [0.08, 0.1, 0.18],
  [0.25, 0.22, 0.2],
  [0.05, 0.05, 0.05],
];

export function figures(engine: Engine, count: number): Figure[] {
  const { geometry, material, object } = engine;
  const matter = (color: [number, number, number]) =>
    material.meshStandard({ color, roughness: 0.8, metalness: 0 });
  const skin = matter([0.72, 0.52, 0.4]);
  const shirts = SHIRTS.map(matter);
  const trousers = TROUSERS.map(matter);
  const torso = geometry.box(0.4, 0.6, 0.22);
  const head = geometry.sphere(0.11, 12, 8);
  const leg = geometry.box(0.14, 0.85, 0.14);
  const arm = geometry.box(0.1, 0.65, 0.1);
  const at = (node: Node3, x: number, y: number, z: number) => (node.position.set(x, y, z), node);
  return Array.from({ length: count }, (_, index) => {
    const shirt = shirts[index % shirts.length];
    const trouser = trousers[(index * 7) % trousers.length];
    const root = object.group();
    // A joint is a group at the hip or shoulder; its limb hangs below it.
    const limb = (shape: unknown, matter: unknown, x: number, y: number, length: number) => {
      const joint = at(object.group(), x, y, 0);
      joint.add(at(object.mesh(shape, matter), 0, -length / 2, 0));
      root.add(joint);
      return joint;
    };
    root.add(at(object.mesh(torso, shirt), 0, 1.2, 0), at(object.mesh(head, skin), 0, 1.63, 0));
    const legs: [Node3, Node3] = [
      limb(leg, trouser, -0.1, 0.9, 0.85),
      limb(leg, trouser, 0.1, 0.9, 0.85),
    ];
    const arms: [Node3, Node3] = [
      limb(arm, shirt, -0.26, 1.46, 0.65),
      limb(arm, shirt, 0.26, 1.46, 0.65),
    ];
    root.visible = false;
    return { root, legs, arms };
  });
}

/** Poses a figure: `phase` of the stride (radians), `gait` 0 standing, 1 walking, 2 hurrying. */
export function stride(figure: Figure, yaw: number, phase: number, gait: number) {
  const swing = gait === 0 ? 0 : gait === 1 ? 0.45 : 0.8;
  const s = Math.sin(phase) * swing;
  figure.root.quaternion.set(...yawPitchRoll(yaw, 0, 0));
  figure.legs[0].quaternion.set(...axisAngle([1, 0, 0], s));
  figure.legs[1].quaternion.set(...axisAngle([1, 0, 0], -s));
  figure.arms[0].quaternion.set(...axisAngle([1, 0, 0], -s * 0.8));
  figure.arms[1].quaternion.set(...axisAngle([1, 0, 0], s * 0.8));
}
