import type { MeshLike, NodeLike, SkyEngine } from './engine.ts';
import { mulberry32 } from '../../random.ts';

/** Illuminance of a magnitude-0 star over the sun's, both outside the air (2.54 µlx / 128 klx). */
const MAGNITUDE_ZERO = 2.54e-6 / 128_000;
/** The faintest star the naked eye sees under a dark sky. */
const FAINTEST = 6;
/** Star counts grow about ×3 per magnitude (log₁₀ N(<m) ≈ 0.47 m + const, Allen's tables). */
const COUNT_SLOPE = 0.47;
const TWO_PI = 2 * Math.PI;

export type Stars = {
  /** The tilted node: its +Y is the celestial pole. The sky keeps it on the camera. */
  node: NodeLike;
  /** Turns the sky with the hours and fades it into daylight (`visibility` 0–1). */
  update(latitude: number, siderealTurn: number, visibility: number): void;
};

/**
 * `count` stars as points on a sphere of `radius`, magnitudes drawn from the naked-eye count
 * law, each coloured by the light it actually sends: a star's point covers one pixel of
 * `pixelSolidAngle` steradians, so its radiance is its illuminance over that angle, in the
 * page's light `unit`.
 */
export function createStars(
  engine: SkyEngine,
  options: { seed: number; count: number; radius: number; unit: number; pixelSolidAngle: number },
): Stars {
  const next = mulberry32(options.seed);
  const positions = new Float32Array(options.count * 3);
  const colours = new Float32Array(options.count * 3);
  const faintest = 10 ** (COUNT_SLOPE * FAINTEST);
  for (let index = 0; index < options.count; index++) {
    const z = next() * 2 - 1;
    const around = next() * TWO_PI;
    const ring = Math.sqrt(1 - z * z);
    positions.set(
      [ring * Math.cos(around), z, ring * Math.sin(around)].map((v) => v * options.radius),
      index * 3,
    );
    // Inverse of the cumulative count: many faint stars, a few bright ones.
    const magnitude = Math.log10(faintest * Math.max(next(), 1e-6)) / COUNT_SLOPE;
    const flux =
      (MAGNITUDE_ZERO * 10 ** (-0.4 * magnitude) * options.unit) / options.pixelSolidAngle;
    const warmth = next();
    colours.set([flux * (0.8 + 0.4 * warmth), flux, flux * (1.2 - 0.4 * warmth)], index * 3);
  }
  const geometry = engine.geometry.createBuffer({
    position: engine.buffer.float32(positions, 3),
    color: engine.buffer.float32(colours, 3),
  });
  const material = engine.material.points({
    size: 1,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const points: MeshLike = engine.object.points(geometry, material);
  points.renderOrder = -1;
  const spin = engine.object.group();
  spin.add(points);
  const node = engine.object.group();
  node.add(spin);
  let shown = -1;
  return {
    node,
    update(latitude, siderealTurn, visibility) {
      // A turn written only when it moves: every write asks the world for another frame.
      const tilt = (latitude * Math.PI) / 180 - Math.PI / 2,
        turn = -siderealTurn * TWO_PI;
      if (node.rotation.x !== tilt) node.rotation.x = tilt;
      if (spin.rotation.y !== turn) spin.rotation.y = turn;
      // An opacity written only when it moves by a visible step: a material rewritten every
      // frame reopens the engine's session.
      const step = Math.round(visibility * 32) / 32;
      if (step !== shown) {
        material.opacity = step;
        points.visible = step > 0;
        shown = step;
      }
    },
  };
}
