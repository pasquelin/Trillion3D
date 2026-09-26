// The fluids scene in the page (`fluids.ts`), built through the public API alone: a world with
// physics, the fixtures' water and bodies, and the THROWAWAY STAND-INS the engine does not draw
// yet. Served under `/runner/` and imported by URL; only types come from the packages.
import type * as SdkBrowser from '../witnesses/measurement.ts';
import type { FluidsPayload, FluidsScene } from './fluids.ts';
import type { GpuPassTimings } from '../../packages/sdk-core/src/index.ts';
import type { PhysicsPart } from '../../packages/sdk-core/src/physics/options.ts';
import { posterCapture } from './measurePage.ts';

type Sdk = typeof SdkBrowser;

/** The bodies, one geometry per distinct part and one material per density shared among them:
 *  a compound's parts are children of its first, each at its place in the body's frame. */
function floatingMeshes(sdk: Sdk, bodies: FluidsScene['bodies']) {
  const geometries = new Map<string, ReturnType<Sdk['geometry']['box']>>(),
    woods = new Map<number, ReturnType<Sdk['material']['meshStandard']>>();
  // The fixture's parts are boxes and spheres.
  const drawn = (part: PhysicsPart) => {
    const key = JSON.stringify(part);
    let shape = geometries.get(key);
    if (!shape) {
      const [x, y, z] = part.position ?? [0, 0, 0];
      shape = (
        part.type === 'box'
          ? sdk.geometry.box(...(part.halfExtents.map((h) => h * 2) as [number, number, number]))
          : sdk.geometry.sphere(part.radius, 16, 12)
      ).translate(x, y, z);
      geometries.set(key, shape);
    }
    return shape;
  };
  return bodies.map(({ position, density, shape }) => {
    let wood = woods.get(density);
    if (!wood)
      woods.set(density, (wood = sdk.material.meshStandard({ color: '#b7793f', density })));
    const parts = shape.type === 'compound' ? shape.parts : [shape];
    const [first, ...rest] = parts.map((part) => sdk.object.mesh(drawn(part), wood));
    first.add(...rest);
    first.position.set(...position);
    first.physics = { type: 'dynamic', shape };
    return first;
  });
}

/** Throwaway stand-ins (#422, #423): a flat transmissive ocean, fires and smoke volumes. */
function standIns(sdk: Sdk, world: ReturnType<Sdk['createWorld']>, scene: FluidsScene) {
  const { geometry, material, object, light } = sdk;
  const sea = object.mesh(
    geometry.plane(400, 400),
    material.meshPhysical({ color: '#1d6d8c', roughness: 0.05, transmission: 1, thickness: 2 }),
  );
  sea.rotation.set(-Math.PI / 2, 0, 0);
  sea.position.set(27, scene.water.level, 27);
  world.scene.add(sea);
  const flame = material.meshBasic({ color: '#ff8a2a', transparent: true, blending: 'additive' });
  const cone = geometry.cone(0.4, 1.2, 12);
  const fires = scene.fires.map(([x, y, z]) => {
    const lamp = light.point({ color: '#ff9a3c', intensity: 40, distance: 12 });
    lamp.position.set(x, y + 0.6, z);
    const body = object.mesh(cone, flame);
    body.position.set(x, y, z);
    world.scene.add(lamp, body);
    return lamp;
  });
  const haze = material.meshStandard({
    color: '#8a8a8a',
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });
  const shells = [1, 2, 3, 4].map((radius) => geometry.sphere(radius, 16, 12));
  for (const [x, y, z] of scene.smokes)
    for (const shell of shells) {
      const layer = object.mesh(shell, haze);
      layer.position.set(x, y, z);
      world.scene.add(layer);
    }
  // Flicker modulates intensity alone, as the fire lights of #417 will.
  return (frame: number) =>
    fires.forEach((lamp, i) => (lamp.intensity = 40 * (0.8 + 0.2 * Math.sin(frame * 0.7 + i))));
}

const nextFrame = () => new Promise<number>((done) => requestAnimationFrame(done));

/** Builds the scene, waits for every body to be simulated, then measures `frames` frames. */
export async function measureFluids({
  sdkUrl,
  renderer,
  settings,
  captureFile,
  scene,
}: FluidsPayload) {
  const { width, height, warmup, frames, temporalAntialiasing } = settings;
  const sdk = (await import(sdkUrl)) as Sdk;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
  document.body.append(canvas);
  // A lost context is published where the bench rereads it (`withGpuIncidents`).
  const lost: string[] = (globalThis.incidentsGpu = []);
  canvas.addEventListener('webglcontextlost', () => lost.push('webglcontextlost'));
  // The world leads its own loop, as every physics example does: a host-led `world.render()`
  // never runs the frame's physics (`world.ts`: only the loop's `beforeFrame` steps it), so its
  // bodies would never reach the worker.
  const world = sdk.createWorld(canvas, { renderer, physics: true, temporalAntialiasing });
  try {
    await world.ready;
    world.scene.background = sdk.math.color('#9cc3d9');
    world.camera.far = 400;
    world.camera.position.set(27, 22, -24);
    world.camera.lookAt(27, 0, 27);
    const sun = sdk.light.directional({ intensity: 3, color: '#fff4e2', castShadow: true });
    sun.position.set(40, 60, -20);
    world.scene.add(sun, sdk.light.hemisphere({ intensity: 1.2 }));
    world.physics.water = scene.water;
    world.scene.add(...floatingMeshes(sdk, scene.bodies));
    const flicker = standIns(sdk, world, scene);
    // Every frame flickers the fires and asks for the next one: the loop never rests.
    let ahead = 0;
    world.beforeFrame(() => {
      flicker(ahead++);
      world.invalidate();
    });
    // Jolt is fetched on first use: the warmup counts from the frame every body is simulated.
    // `bodies` counts what the page registered, `active` comes only with a worker tick; `stats`
    // is reread each frame, the session that holds it starting after the first frames.
    const stats = () => world.physics.stats;
    // Waits frame by frame for `reached`: a physics error, or `limit` frames without it (a loop
    // that stopped, a session that did not reopen), ends the run instead of hanging it.
    const until = async (reached: () => boolean, limit: number, state: () => string) => {
      for (let wait = 0; !reached(); wait++) {
        if (wait > limit || world.physics.error)
          throw new Error(`${state()}: ${world.physics.error ?? 'timed out'}`);
        await nextFrame();
      }
    };
    await until(
      () => stats().bodies >= scene.bodies.length && !!stats().active,
      1800,
      () => `${stats().bodies} bodies, ${stats().active} awake`,
    );
    const result = {
      cpuFrameMs: [] as number[],
      gpuFrameMs: [] as number[],
      rafIntervalMs: [] as number[],
      gpuPassSamples: [] as GpuPassTimings[],
      physicsStepMs: [] as number[],
      physicsMainMs: [] as number[],
    };
    let previous: number | null = null;
    let drawn = 0;
    // A WebGPU device lost mid-run reopens the session without an event on the canvas.
    const sessions = world.diagnostic.sessions;
    const total = warmup + frames;
    const remove = world.onFrame(({ time, metrics: frame }) => {
      if (++drawn <= warmup) return;
      // The interval between two frames the world's loop drew: the frame envelope.
      const now = time * 1000;
      if (previous !== null) result.rafIntervalMs.push(now - previous);
      previous = now;
      result.cpuFrameMs.push(frame.cpuFrameMs);
      const sample = frame.gpuPassMs;
      // The device is sampled every few frames: one reading per sampled frame, not per drawn frame.
      if (sample && sample.frame !== result.gpuPassSamples.at(-1)?.frame) {
        result.gpuPassSamples.push(sample);
        if (typeof frame.gpuFrameMs === 'number') result.gpuFrameMs.push(frame.gpuFrameMs);
      }
      const { stepMs, mainMs } = stats();
      result.physicsStepMs.push(stepMs);
      result.physicsMainMs.push(mainMs);
      if (drawn === total) remove();
    });
    // The world's loop draws one frame per display frame: 600 more (ten seconds) is a stopped loop.
    await until(
      () => drawn >= total,
      total + 600,
      () => `${drawn} of ${total} frames drawn`,
    );
    const shot = await sdk.capture.buffer(world, { width, height });
    await posterCapture(captureFile, shot.data, shot.width, shot.height);
    if (world.diagnostic.sessions !== sessions)
      lost.push(`session reopened: ${world.diagnostic.error?.code ?? 'device lost'}`);
    const size = { width: canvas.width, height: canvas.height, dpr: devicePixelRatio };
    // A context lost mid-run that threw nothing still voids the numbers: the row says so.
    return { ...result, bodies: stats().bodies, size, lost };
  } finally {
    world.dispose();
    canvas.remove();
  }
}
