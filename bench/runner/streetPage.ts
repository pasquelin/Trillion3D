// What runs INSIDE the page to find the model's street (`street.ts`). Playwright serialises this
// function: it reads nothing outside its single argument, the columns Node chose.
import type * as SdkBrowser from '../witnesses/measurement.ts';
import type { ColumnProbe, StreetProbeOptions } from './street.ts';

/**
 * Asks the physics the compiler cooked with the model (`physics.json`) about each column: the
 * ground under it — the model's floor when nothing is —, how far the nearest wall stands one eye above that ground among eight headings,
 * and whether the sky is open over the whole square the camera may walk there — `reachShare` of
 * that clearance each side, swept up from the eye. Exact queries on the cooked triangles
 * (`world.raycast(ray, { exact: true })`, `{ shape }`): the engine's own, no second copy of the
 * geometry.
 */
export async function probeColumns(options: StreetProbeOptions): Promise<ColumnProbe[]> {
  const sdk = (await import(options.sdkUrl)) as typeof SdkBrowser;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:64px;height:64px';
  document.body.append(canvas);
  const world = sdk.createWorld(canvas, { physics: true });
  const frame = () => new Promise((done) => requestAnimationFrame(done));
  try {
    await world.ready;
    await world.scene.load(options.manifestUrl);
    const [cx, cz] = options.centre;
    world.camera.position.set(cx, options.top, cz);
    // The physics streams the cooked tiles on its own: the probe waits until the bodies it holds
    // stop changing, bounded so a model that never lands ends the run instead of hanging it.
    let bodies = -1;
    for (let still = 0, wait = 0; still < options.settleFrames; wait++) {
      if (wait > options.frameLimit || world.physics.error)
        throw new Error(`street probe: ${world.physics.error ?? 'physics never settled'}`);
      await frame();
      const now = world.physics.stats.bodies;
      still = now > 0 && now === bodies ? still + 1 : 0;
      bodies = now;
    }
    const v = sdk.math.vector3;
    const cast = async (from: number[], to: number[], reach: number, half = 0) => {
      const ray = sdk.math.ray(v(from[0], from[1], from[2]), v(to[0], to[1], to[2]));
      const shape = { type: 'box' as const, halfExtents: { x: half, y: half / 64, z: half } };
      const hit = await world.raycast(
        ray,
        half > 0 ? { shape, maxDistance: reach } : { exact: true, maxDistance: reach },
      );
      return hit ? hit.distance : null;
    };
    // Three waves over every column, each cast independent of the other columns: the grounds, then
    // the walls one eye above them, then the sky over the square the camera may walk.
    const drops = await Promise.all(
      options.columns.map(([x, z]) =>
        // Nothing under the column down to an eye below the model's floor: it stands on that floor.
        cast([x, options.top, z], [0, -1, 0], options.top - options.floor + options.eye),
      ),
    );
    const grounds = drops.map((drop) => (drop === null ? options.floor : options.top - drop));
    const clearances = await Promise.all(
      options.columns.map(async ([x, z], i) => {
        const eye = grounds[i] + options.eye;
        const walls = await Promise.all(
          options.headings.map(([dx, dz]) => cast([x, eye, z], [dx, 0, dz], options.reach)),
        );
        return Math.min(...walls.map((wall) => wall ?? options.reach));
      }),
    );
    const skies = await Promise.all(
      options.columns.map(([x, z], i) => {
        const room = Math.max(clearances[i] * options.reachShare, options.eye / 64);
        return cast([x, grounds[i] + options.eye, z], [0, 1, 0], options.height, room);
      }),
    );
    const probes: ColumnProbe[] = options.columns.map(([x, z], i) => ({
      x,
      z,
      ground: grounds[i],
      open: skies[i] === null,
      clearance: clearances[i],
    }));
    return probes;
  } finally {
    world.dispose();
    canvas.remove();
  }
}
