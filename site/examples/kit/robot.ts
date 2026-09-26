import type * as Engine from '../../../packages/sdk-browser/src/index.ts';

type Families = Pick<typeof Engine, 'geometry' | 'material' | 'object' | 'animation'>;
type Node = ReturnType<Families['object']['group']>;
type Shape = Parameters<Families['object']['mesh']>[0];
type Look = ReturnType<Families['material']['meshStandard']>;
type Vec3 = [number, number, number];

/**
 * A robot and its three clips, playing together on one mixer: `walk`, `wave` and `dance`. The
 * robot is a tree of named groups, each joint a group the clips turn; `paint` is its body's
 * material, `actions` the three playing clips by name, whose weights blend them. The caller adds
 * `robot` to its scene.
 */
export function walkingRobot({ geometry, material, object, animation }: Families) {
  const paint = material.meshStandard({ color: '#f2b134', metalness: 0.3, roughness: 0.35 });
  const steel = material.meshStandard({ color: '#3b4250', metalness: 0.9, roughness: 0.3 });
  const eyes = material.meshStandard({
    color: '#000000',
    emissive: '#6ff7ff',
    emissiveIntensity: 8,
  });
  function part(name: string, shape: Shape | null, matter: Look | null, at: Vec3, parent: Node) {
    const joint = object.group();
    joint.name = name;
    joint.position.set(...at);
    if (shape) joint.add(object.mesh(shape, matter as Look));
    parent.add(joint);
    return joint;
  }
  function limb(name: string, at: Vec3, parent: Node, length: number) {
    const joint = part(name, null, null, at, parent);
    const bone = object.mesh(geometry.capsule(0.13, length, 8, 24), steel);
    bone.position.y = -length / 2 - 0.1;
    const hand = object.mesh(geometry.sphere(0.17, 24, 16), paint);
    hand.position.y = -length - 0.2;
    joint.add(bone, hand);
    return joint;
  }
  const robot = object.group();
  const hips = part('hips', geometry.box(0.9, 1.1, 0.55), paint, [0, 1.55, 0], robot);
  const head = part('head', geometry.box(0.7, 0.55, 0.6), paint, [0, 0.9, 0], hips);
  for (const side of [-1, 1]) {
    const eye = object.mesh(geometry.sphere(0.07, 16, 12), eyes);
    eye.position.set(side * 0.16, 0.05, 0.3);
    head.add(eye);
  }
  limb('armL', [-0.6, 0.45, 0], hips, 0.8);
  limb('armR', [0.6, 0.45, 0], hips, 0.8);
  limb('legL', [-0.25, -0.55, 0], hips, 0.7);
  limb('legR', [0.25, -0.55, 0], hips, 0.7);

  // Three clips, each a list of keyed tracks: `node.property.axis`, times, values.
  const swing = (name: string, times: number[], values: number[]) =>
    animation.numberTrack(name, times, values);
  const walk = animation.clip('walk', 1, [
    swing('legL.rotation.x', [0, 0.5, 1], [0.6, -0.6, 0.6]),
    swing('legR.rotation.x', [0, 0.5, 1], [-0.6, 0.6, -0.6]),
    swing('armL.rotation.x', [0, 0.5, 1], [-0.5, 0.5, -0.5]),
    swing('armR.rotation.x', [0, 0.5, 1], [0.5, -0.5, 0.5]),
    swing('hips.position.y', [0, 0.25, 0.5, 0.75, 1], [1.55, 1.63, 1.55, 1.63, 1.55]),
  ]);
  const wave = animation.clip('wave', 0.8, [
    swing('armR.rotation.z', [0, 0.4, 0.8], [2.3, 2.8, 2.3]),
    swing('head.rotation.z', [0, 0.4, 0.8], [-0.15, 0.1, -0.15]),
  ]);
  const dance = animation.clip('dance', 1.2, [
    swing('hips.rotation.y', [0, 0.3, 0.9, 1.2], [0, 0.5, -0.5, 0]),
    swing('armL.rotation.z', [0, 0.6, 1.2], [-0.4, -2.4, -0.4]),
    swing('head.rotation.x', [0, 0.3, 0.6, 0.9, 1.2], [0, 0.25, 0, 0.25, 0]),
  ]);
  const mixer = animation.createMixer(robot);
  const actions = { walk: mixer.play(walk), wave: mixer.play(wave), dance: mixer.play(dance) };
  return { robot, paint, actions };
}
