import { normalise, scale } from './atmosphere.ts';
import type { Daylight } from './daylight.ts';
import { unitAt } from './dome.ts';
import type { ColorLike, LightLike, Rgb, SkyEngine, SkyWorld } from './engine.ts';

/** The environment picture's size: one texel every 11.25°, enough for a diffuse sky. */
const ENV_WIDTH = 32;
const ENV_HEIGHT = 16;
/** Four cascades: each twice to four times the reach of the one before (the usual split). */
const CASCADES = 4;

export type SkyLights = {
  key: LightLike;
  fill: LightLike;
  /** Writes one moment into the lights, the background, the fog and the environment. */
  apply(day: Daylight, horizon: Rgb): void;
  /** Keeps the key light's shadow frustum on the camera. */
  follow(camera: { x: number; y: number; z: number }): void;
};

const set = (colour: ColorLike, c: Rgb) => colour.setRGB(c[0], c[1], c[2]);

/**
 * The lights the sky gives the scene, in the page's light `unit` (the key light's intensity for
 * a zenith sun): one shadow-casting directional light for the sun or the moon, a hemisphere
 * light for the sky above and the ground below, and the scene's background, fog and
 * environment kept on the same colours.
 */
export function createSkyLights(
  engine: SkyEngine,
  world: Pick<SkyWorld, 'scene'>,
  options: { unit: number; shadowReach: number; fogNear: number; fogFar: number },
): SkyLights {
  const key: LightLike = engine.light.directional({ castShadow: true });
  // Waiting on the engine: cascaded shadow settings (cascade count and reach).
  key.shadow = { cascades: CASCADES, distance: options.shadowReach };
  const fill = engine.light.hemisphere({});
  const scene = world.scene;
  scene.add(key, fill, key.target);
  const background = engine.math.color();
  scene.background = background;
  // Waiting on the engine: `scene.fog` (aerial perspective over the world's distances).
  scene.fog = { color: engine.math.color(), near: options.fogNear, far: options.fogFar };
  const pixels = new Float32Array(ENV_WIDTH * ENV_HEIGHT * 4);
  const environment = engine.texture.data(pixels, ENV_WIDTH, ENV_HEIGHT, 'rgba');
  // Waiting on the engine: environment lighting (IBL) from `scene.environment`.
  scene.environment = environment;
  let direction: Rgb = [0, 1, 0];
  const distance = options.shadowReach;

  return {
    key,
    fill,
    apply(day, horizon) {
      direction = day.key.direction;
      set(key.color, day.key.colour);
      key.intensity = options.unit * day.key.illuminance;
      const sky = normalise(day.fill.sky);
      set(fill.color, sky.colour);
      fill.intensity = options.unit * sky.peak;
      set(fill.groundColor, scale(day.fill.ground, sky.peak > 0 ? 1 / sky.peak : 0));
      set(background, horizon);
      if (scene.fog) set(scene.fog.color, horizon);
      for (let row = 0; row < ENV_HEIGHT; row++)
        for (let column = 0; column < ENV_WIDTH; column++) {
          const view = unitAt((row + 0.5) / ENV_HEIGHT, (column + 0.5) / ENV_WIDTH);
          const radiance = day.radiance(view);
          const at = (row * ENV_WIDTH + column) * 4;
          for (let c = 0; c < 3; c++) pixels[at + c] = radiance[c] * options.unit;
          pixels[at + 3] = 1;
        }
      environment.needsUpdate = true;
    },
    follow(camera) {
      key.target.position.set(camera.x, camera.y, camera.z);
      key.position.set(
        camera.x + direction[0] * distance,
        camera.y + direction[1] * distance,
        camera.z + direction[2] * distance,
      );
    },
  };
}
