import { scale } from './atmosphere.ts';
import type { Daylight } from './daylight.ts';
import type { MeshLike, NodeLike, Rgb, SkyEngine } from './engine.ts';

/** Rings from the zenith to the nadir and steps around: one vertex every 7.5°. */
const RINGS = 24;
const AROUND = 48;
/** The angular radius of the sun's and the moon's discs, radians. */
export const DISC = (0.266 * Math.PI) / 180;
/** The moon's geometric albedo: how much of the sunlight on its face it returns. */
const MOON_ALBEDO = 0.12;

/** The unit direction a fraction `down` of the way from zenith to nadir, `around` of a turn. */
export function unitAt(down: number, around: number): Rgb {
  const polar = down * Math.PI;
  const azimuth = around * 2 * Math.PI;
  return [
    Math.sin(polar) * Math.cos(azimuth),
    Math.cos(polar),
    Math.sin(polar) * Math.sin(azimuth),
  ];
}

/** The dome's triangles: one quad per ring and step, two triangles each. */
function domeIndices(): Uint32Array {
  const indices: number[] = [];
  const row = AROUND + 1;
  for (let ring = 0; ring < RINGS; ring++)
    for (let step = 0; step < AROUND; step++) {
      const a = ring * row + step;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  return new Uint32Array(indices);
}

export type Dome = {
  /** The node that holds the dome, the sun and the moon; the sky keeps it on the camera. */
  node: NodeLike;
  /** Repaints the gradient and moves the discs to the moment `day` describes. */
  paint(day: Daylight): void;
  /** The mean horizon colour of the last paint: the background and the fog read it. */
  horizon: Rgb;
};

/**
 * A sky dome whose colour at every vertex is the atmosphere's radiance along that direction
 * (vertex colours, unlit), with the sun's and the moon's discs at their true angular size.
 * `radius` stays inside the camera's far plane; `unit` is the page's light unit.
 */
export function createDome(engine: SkyEngine, radius: number, unit: number): Dome {
  const count = (RINGS + 1) * (AROUND + 1);
  const positions = new Float32Array(count * 3);
  const directions: Rgb[] = [];
  for (let ring = 0; ring <= RINGS; ring++)
    for (let step = 0; step <= AROUND; step++) {
      const d = unitAt(ring / RINGS, step / AROUND);
      directions.push(d);
      positions.set([d[0] * radius, d[1] * radius, d[2] * radius], directions.length * 3 - 3);
    }
  const colours = engine.buffer.float32(new Float32Array(count * 3), 3);
  const geometry = engine.geometry.createBuffer({
    position: engine.buffer.float32(positions, 3),
    color: colours,
    index: engine.buffer.uint32(domeIndices(), 1),
  });
  // Waiting on the engine: `fog: false` (the dome must not fade into its own fog).
  const shell = engine.object.mesh(
    geometry,
    engine.material.meshBasic({
      vertexColors: true,
      side: engine.side.double,
      depthWrite: false,
      fog: false,
    }),
  );
  shell.renderOrder = -2;
  const disc = (at: number) => {
    const glow = engine.material.meshBasic({ color: 0xffffff, depthWrite: false, fog: false });
    const body = engine.object.mesh(engine.geometry.sphere(at * Math.tan(DISC), 16, 8), glow);
    body.renderOrder = -1;
    return { body, glow };
  };
  const sun = disc(radius * 0.98);
  const moon = disc(radius * 0.97);
  const node = engine.object.group();
  node.add(shell, sun.body, moon.body);
  const discSolidAngle = Math.PI * DISC * DISC;

  const dome: Dome = {
    node,
    horizon: [0, 0, 0],
    paint(day) {
      const sum = [0, 0, 0];
      directions.forEach((d, index) => {
        const colour = scale(day.radiance(d), unit);
        colours.array[index * 3] = colour[0];
        colours.array[index * 3 + 1] = colour[1];
        colours.array[index * 3 + 2] = colour[2];
        if (Math.abs(d[1]) < 1e-6) for (let c = 0; c < 3; c++) sum[c] += colour[c];
      });
      colours.needsUpdate = true;
      dome.horizon = [sum[0] / (AROUND + 1), sum[1] / (AROUND + 1), sum[2] / (AROUND + 1)];
      place(sun.body, day.sun, radius * 0.98);
      place(moon.body, day.moon, radius * 0.97);
      // A disc's radiance is the illuminance it sends over the solid angle it covers.
      const sunDisc = (day.key.direction === day.sun ? day.key.illuminance : 0) / discSolidAngle;
      const disc = scale(day.key.colour, sunDisc * unit);
      sun.glow.color.setRGB(disc[0], disc[1], disc[2]);
      sun.body.visible = day.sun[1] > -DISC;
      const moonDisc = (MOON_ALBEDO * day.moonLit * unit) / Math.PI;
      moon.glow.color.setRGB(moonDisc, moonDisc, moonDisc * 0.95);
      moon.body.visible = day.moon[1] > -DISC && day.moonLit > 0.02;
    },
  };
  return dome;
}

function place(body: MeshLike, direction: Rgb, distance: number) {
  body.position.set(direction[0] * distance, direction[1] * distance, direction[2] * distance);
}
