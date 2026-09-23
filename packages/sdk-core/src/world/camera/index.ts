import { Camera, type CameraParameters, type CameraPose } from './camera.ts';

/**
 * The `camera` family. A cube, stereo or array camera is a set of perspective eyes placed as its
 * children; the world draws from the one it is given.
 */
export const camera = {
  /**
   * A camera like an eye: things far away look smaller.
   * @param p - The camera's optics; every field is optional.
   */
  perspective: (p?: CameraParameters) => new Camera('perspective', p),
  /**
   * A camera with no perspective: things keep their size at any distance.
   * @param p - The camera's view box; every field is optional.
   */
  orthographic: (p?: CameraParameters) => new Camera('orthographic', p),
  /**
   * Six eyes of 90° on the axes, children of one node.
   * @param p - The nearest and farthest distances the six eyes draw.
   */
  cube(p: { near?: number; far?: number } = {}) {
    const rig = new Camera('perspective', { fov: 90, near: p.near, far: p.far });
    for (const [x, y, z] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      const face = new Camera('perspective', { fov: 90, near: p.near, far: p.far });
      rig.add(face);
      face.up.set(0, y === 0 ? -1 : 0, y === 0 ? 0 : z === 0 ? y : 1);
      face.lookAt(x, y, z);
    }
    return rig;
  },
  /** Two eyes `eyeSep` apart on the x axis: a human interocular distance, 64 mm. */
  stereo() {
    const eyeSep = 0.064;
    const left = new Camera('perspective'),
      right = new Camera('perspective');
    left.position.x = -eyeSep / 2;
    right.position.x = eyeSep / 2;
    return { left, right, eyeSep };
  },
  /**
   * One node holding the given eyes.
   * @param cameras - The eyes to hold.
   */
  array(cameras: Camera[]) {
    const rig = new Camera('perspective');
    rig.add(...cameras);
    return rig;
  },
};

export { Camera, type CameraParameters, type CameraPose };
