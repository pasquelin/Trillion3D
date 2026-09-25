// The fluids scene in the page (`fluids.ts`), built through the public API alone: a world with
// physics, the fixtures' water and bodies, and the THROWAWAY STAND-INS the engine does not draw
// yet. Served under `/runner/` and imported by URL; only types come from the packages.
import type * as SdkBrowser from '../witnesses/measurement.ts';
import type { FluidsPayload, FloatingBody } from './fluids.ts';
import type { PhysicsPrimitive } from '../../packages/sdk-core/src/physics/options.ts';
import { posterCapture } from './measurePage.ts';

type Sdk = typeof SdkBrowser;

/** A primitive's drawn geometry, at its place in the body's frame. */
function drawnPart(sdk: Sdk, part: PhysicsPrimitive & { position?: readonly number[] }) {
  const shape =
    part.type === 'sphere'
      ? sdk.geometry.sphere(part.radius, 16, 12)
      : part.type === 'box'
        ? sdk.geometry.box(
            part.halfExtents[0] * 2,
            part.halfExtents[1] * 2,
            part.halfExtents[2] * 2,
          )
        : null;
  if (!shape) throw new Error(`fluids page: no drawn shape for ${part.type}`);
  const [x, y, z] = part.position ?? [0, 0, 0];
  return shape.translate(x, y, z);
}

/** A floating body: a mesh drawn as its shape, a compound's parts as children of the first. */
function floatingMesh(sdk: Sdk, body: FloatingBody) {
  const wood = sdk.material.meshStandard({
    color: '#b7793f',
    roughness: 0.8,
    density: body.density,
  });
  const parts =
    body.shape.type === 'compound' ? body.shape.parts : [body.shape as PhysicsPrimitive];
  const [first, ...rest] = parts.map((part) => sdk.object.mesh(drawnPart(sdk, part), wood));
  first.add(...rest);
  first.position.set(...body.position);
  first.physics = { type: 'dynamic', shape: body.shape };
  return first;
}

/** Throwaway stand-ins (#422, #423): a flat transmissive ocean, fires and smoke volumes. */
function standIns(sdk: Sdk, world: ReturnType<Sdk['createWorld']>, o: FluidsPayload) {
  const { geometry, material, object, light } = sdk;
  const sea = object.mesh(
    geometry.plane(400, 400),
    material.meshPhysical({ color: '#1d6d8c', roughness: 0.05, transmission: 1, thickness: 2 }),
  );
  sea.rotation.set(-Math.PI / 2, 0, 0);
  sea.position.set(27, o.scene.water.level, 27);
  world.scene.add(sea);
  const flame = material.meshBasic({ color: '#ff8a2a', transparent: true, blending: 'additive' });
  const fires = o.scene.fires.map(([x, y, z]) => {
    const lamp = light.point({ color: '#ff9a3c', intensity: 40, distance: 12 });
    lamp.position.set(x, y + 0.6, z);
    const cone = object.mesh(geometry.cone(0.4, 1.2, 12), flame);
    cone.position.set(x, y, z);
    world.scene.add(lamp, cone);
    return lamp;
  });
  const haze = material.meshStandard({
    color: '#8a8a8a',
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });
  for (const [x, y, z] of o.scene.smokes)
    for (let layer = 1; layer <= 4; layer++) {
      const shell = object.mesh(geometry.sphere(layer, 16, 12), haze);
      shell.position.set(x, y, z);
      world.scene.add(shell);
    }
  // Flicker modulates intensity alone, as the fire lights of #417 will.
  return (frame: number) =>
    fires.forEach((lamp, i) => (lamp.intensity = 40 * (0.8 + 0.2 * Math.sin(frame * 0.7 + i))));
}

const nextFrame = () => new Promise<number>((done) => requestAnimationFrame(done));

/** Builds the scene, waits for every body to be simulated, then measures `frames` frames. */
export async function measureFluids(o: FluidsPayload) {
  const sdk = (await import(o.sdkUrl)) as Sdk;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `display:block;width:${o.width}px;height:${o.height}px`;
  document.body.append(canvas);
  const world = sdk.createWorld(canvas, {
    renderer: o.renderer,
    interactive: false,
    physics: true,
    temporalAntialiasing: o.temporalAntialiasing,
  });
  try {
    await world.ready;
    world.scene.background = sdk.math.color('#9cc3d9');
    world.camera.far = 400;
    world.camera.position.set(27, 22, -24);
    world.camera.lookAt(27, 0, 27);
    const sun = sdk.light.directional({ intensity: 3, color: '#fff4e2', castShadow: true });
    sun.position.set(40, 60, -20);
    world.scene.add(sun, sdk.light.hemisphere({ intensity: 1.2 }));
    world.physics.water = o.scene.water;
    for (const body of o.scene.bodies) world.scene.add(floatingMesh(sdk, body));
    const flicker = standIns(sdk, world, o);
    // Jolt is fetched on first use: the warmup counts from the frame every body is simulated.
    for (let wait = 0; world.physics.stats.bodies < o.scene.bodies.length; wait++) {
      if (wait > 1800) return { erreur: `${world.physics.stats.bodies} bodies simulated` };
      world.render();
      await nextFrame();
    }
    const result = {
      cpuFrameMs: [] as number[],
      gpuFrameMs: [] as number[],
      rafIntervalMs: [] as number[],
      gpuPassSamples: [] as NonNullable<ReturnType<typeof sdk.metric.frame>['gpuPassMs']>[],
      physicsStepMs: [] as number[],
      physicsMainMs: [] as number[],
    };
    let previous: number | null = null;
    for (let i = 0; i < o.warmup + o.frames; i++) {
      const now = await nextFrame();
      flicker(i);
      world.render();
      if (i < o.warmup) continue;
      if (previous !== null) result.rafIntervalMs.push(now - previous);
      previous = now;
      const frame = sdk.metric.frame(world);
      result.cpuFrameMs.push(frame.cpuFrameMs);
      const sample = frame.gpuPassMs;
      // The device is sampled every few frames: one reading per sampled frame, not per render.
      if (sample && sample.frame !== result.gpuPassSamples.at(-1)?.frame) {
        result.gpuPassSamples.push(sample);
        if (typeof frame.gpuFrameMs === 'number') result.gpuFrameMs.push(frame.gpuFrameMs);
      }
      result.physicsStepMs.push(world.physics.stats.stepMs);
      result.physicsMainMs.push(world.physics.stats.mainMs);
    }
    const shot = await sdk.capture.buffer(world, { width: o.width, height: o.height });
    await posterCapture(o.captureFile, shot.data, shot.width, shot.height);
    const size = { width: canvas.width, height: canvas.height, dpr: devicePixelRatio };
    return { ...result, bodies: world.physics.stats.bodies, size };
  } catch (error) {
    return { erreur: String(error) };
  } finally {
    world.dispose();
    canvas.remove();
  }
}
