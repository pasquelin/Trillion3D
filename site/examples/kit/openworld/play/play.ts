import { between, client, turnBetween } from './client.ts';
import { cameraState, placeCamera } from './camera.ts';
import { hud as createHud } from './hud.ts';
import { input as createInput } from './input.ts';
import { KEYS, readInputs, type Look } from './keys.ts';
import { approach, clamp, headingOf, rotate } from './math3.ts';
import { movingWorld } from './movers.ts';
import { FLAG, H, layout, MODES, type SimWorld } from './protocol.ts';
import { DEFAULT_MODELS } from './specs.ts';
import type { Mode, PlayOptions } from './types.ts';
import { view as createView } from './view.ts';
import { vehicleAt } from './reach.ts';

/**
 * The play layer of the open world: it starts the simulation worker, reads the keys and the
 * mouse, and every frame poses the camera, the vehicles, the traffic, the pedestrians and the
 * movers between the worker's last two snapshots, then the HUD. It never waits on the worker.
 */
export function createPlay(options: PlayOptions) {
  const { world, engine, data } = options;
  const models = { ...DEFAULT_MODELS, ...options.models };
  const limits = {
    radius: options.radius ?? 2500,
    traffic: options.traffic ?? 40,
    pedestrians: options.pedestrians ?? 60,
  };
  const moving = movingWorld(data.movers, data.roads);
  const shape = layout(limits, moving.length);
  const car = models.car;
  const simWorld: SimWorld = {
    seed: data.seed,
    size: data.size,
    tile: data.tile,
    heightSamples: data.heightSamples,
    roads: data.roads,
    settlements: data.settlements,
    markers: data.markers,
    movers: data.movers,
    car: { wheels: car.anchors?.wheels ?? [], mass: car.mass },
  };
  // A template's braces would be escaped by URL resolution: they are kept aside meanwhile.
  const resolve = (template: string) =>
    new URL(template.replace(/\{(tx|tz)\}/g, '__$1__'), document.baseURI).href.replace(
      /__(tx|tz)__/g,
      '{$1}',
    );
  const sim = client(
    options.urls?.worker ?? new URL('./openworldSim.js', import.meta.url).href,
    {
      world: simWorld,
      limits,
      heights: resolve(options.heights),
      colliders: options.colliders ? resolve(options.colliders) : null,
      jolt: options.urls?.jolt ?? new URL('./jolt-physics.wasm.js', import.meta.url).href,
    },
    shape.length,
  );
  const keys = createInput(world.canvas);
  const scene = createView(engine, world.scene, models, shape, limits, moving, data.markers);
  const hud = createHud(data.roads, data.size);
  const start = data.markers.find((m) => m.kind === 'teleport');
  const look: Look = { yaw: start?.yaw ?? 0, pitch: 0 };
  const camera = cameraState();
  let mode: Mode = 'foot';
  let [views, idle] = [0, 0];
  const unhook = world.onFrame(({ delta }) => {
    const mouse = keys.take();
    const vehicle = mode === 'car' || mode === 'plane';
    look.yaw -= mouse.dx * 0.0022;
    look.pitch = clamp(look.pitch - mouse.dy * 0.0022, -1.5, 1.5);
    // A vehicle's camera swings back behind it once the mouse rests.
    idle = mouse.dx || mouse.dy ? 0 : idle + delta;
    if (vehicle && idle > 1.5 && !camera.cockpit) {
      const ease = 1 - approach(delta, 0.4);
      look.yaw *= ease;
      look.pitch *= ease;
    }
    if (keys.presses(KEYS.view) !== views) {
      views = keys.presses(KEYS.view);
      camera.cockpit = !camera.cockpit;
    }
    sim.inputs(readInputs(keys, mode, look));
    if (!sim.received()) return;
    const t = sim.blend();
    const { next } = sim;
    const now = MODES[next[H.mode]];
    const turn = turnBetween(sim, H.qx, t);
    if (now !== mode) {
      // Out of a vehicle, the head faces the way the vehicle did.
      const forward = rotate(turn, [0, 0, -1]);
      if (now === 'foot') look.yaw = headingOf(forward[0], forward[2]);
      else look.yaw = look.pitch = 0;
      mode = now;
    }
    const at = between(sim, H.x, t);
    const flags = next[H.flags];
    scene.update(sim, t, delta);
    placeCamera(
      world.camera,
      camera,
      {
        mode,
        at,
        turn,
        speed: next[H.speed],
        crouched: (flags & FLAG.crouched) !== 0,
        running: (flags & FLAG.running) !== 0,
        grounded: (flags & FLAG.grounded) !== 0,
        look,
        seat: (mode === 'car' ? models.car : models.plane).anchors?.eye ?? null,
      },
      delta,
    );
    const forward = rotate(turn, [0, 0, -1]);
    const ground = next[H.ground];
    hud.update({
      mode,
      speed: next[H.speed],
      altitude: at[1],
      aboveGround: Number.isNaN(ground) ? null : at[1] - ground,
      stamina: next[H.stamina],
      throttle: next[H.throttle],
      stalled: (flags & FLAG.stalled) !== 0,
      loading: (flags & FLAG.loading) !== 0,
      prompt: mode === 'foot' ? vehicleAt(sim, shape, data.markers, at) : null,
      x: at[0],
      z: at[2],
      heading: mode === 'foot' ? look.yaw : headingOf(forward[0], forward[2]),
    });
    world.invalidate();
  });
  const teleports = data.markers.flatMap((m) => (m.kind === 'teleport' ? [m] : []));
  return {
    /** Resolves once the simulation runs; rejects when the worker or Jolt fails to start. */
    ready: sim.ready,
    get mode() {
      return mode;
    },
    /** The teleport markers' names, in the world's order. */
    teleports: teleports.map((m) => m.name),
    teleport(name: string) {
      const marker = teleports.find((m) => m.name === name);
      if (!marker) return;
      [look.yaw, look.pitch] = [marker.yaw, marker.pitch ?? 0];
      sim.send({ type: 'teleport', name });
    },
    /** Headlights and beacons on at night. */
    set night(on: boolean) {
      scene.night(on);
    },
    /** What the simulation reports, for a readout: all measured by the worker, per step. */
    get state() {
      const n = sim.next;
      return {
        mode,
        stepMs: n[H.stepMs],
        bodies: n[H.bodies],
        tiles: n[H.cached],
        traffic: n[H.traffic],
        pedestrians: n[H.pedestrians],
        missingModels: scene.missing,
      };
    },
    dispose() {
      unhook();
      sim.dispose();
      keys.dispose();
      hud.dispose();
      scene.dispose();
    },
  };
}

export type Play = ReturnType<typeof createPlay>;
