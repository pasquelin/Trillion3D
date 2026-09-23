import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  Marker,
  Mover,
} from '../../../../../scripts/docs/examples/openworld/plan/contract.ts';
import { cloudWindow, createClouds, wrapAround } from './clouds.ts';
import { createEffects } from './effects.ts';
import type { SkyEngine } from './engine.ts';
import { PRESETS } from './presets.ts';
import { createSky } from './sky.ts';
import { createWind } from './wind.ts';

/** The engine's families as plain records: enough to build and move the sky's objects. */
function fakeEngine(): SkyEngine {
  const vector = () => ({
    x: 0,
    y: 0,
    z: 0,
    set(x: number, y: number, z: number) {
      Object.assign(this, { x, y, z });
    },
  });
  const node = () => ({
    position: vector(),
    rotation: vector(),
    scale: vector(),
    visible: true,
    children: [] as unknown[],
    add(...children: unknown[]) {
      this.children.push(...children);
    },
  });
  const colour = () => ({ ...vector(), setRGB: vector().set });
  const material = (parameters: object = {}) => ({ ...parameters, color: colour() });
  const light = () => ({ ...node(), color: colour(), groundColor: colour(), target: node() });
  const float32 = (values: ArrayLike<number>) => ({ array: Float32Array.from(values) });
  const withGeometry = (geometry: unknown) => ({ ...node(), geometry });
  return {
    geometry: { sphere: () => ({}), cone: () => ({}), createBuffer: (a: object) => a },
    buffer: { float32, uint32: float32 },
    material: { meshBasic: material, meshStandard: material, points: material, line: material },
    object: { mesh: withGeometry, points: withGeometry, lineSegments: withGeometry, group: node },
    light: { directional: light, hemisphere: light },
    math: { color: colour },
    texture: { data: () => ({}) },
    blending: { normal: 'normal', additive: 'additive' },
    side: { back: 'back', double: 'double' },
  } as unknown as SkyEngine;
}

const wind = () => createWind(7, { speed: 8, heading: 0.5, gustiness: 0.4 });

describe('clouds', () => {
  it('brings a coordinate back into the window around the centre', () => {
    for (const value of [-1e5, -12_345, 0, 999, 7e4])
      for (const centre of [-2e4, 0, 3.3e4]) {
        const wrapped = wrapAround(value, centre, 10_000);
        assert.ok(wrapped >= centre - 5_000 && wrapped < centre + 5_000);
        assert.ok(Math.abs(((wrapped - value) / 10_000) % 1) < 1e-9);
      }
  });

  it('keeps every cloud around a camera flying across the world, with the count fixed', () => {
    const settings = { dewSpread: 12, cover: 0.35, count: 24 };
    const clouds = createClouds(fakeEngine(), 11, settings);
    const air = wind();
    const half = cloudWindow(settings) / 2;
    for (let second = 0; second < 600; second++) {
      const camera = { x: -25_000 + second * 90, z: 10_000 - second * 30 };
      air.advance(1);
      clouds.update(1, camera, air);
      const positions = clouds.positions();
      assert.equal(positions.length, 24);
      for (const p of positions)
        assert.ok(Math.abs(p.x - camera.x) <= half && Math.abs(p.z - camera.z) <= half);
    }
  });

  it('lays out the same sky from the same seed, another from another', () => {
    const settings = { dewSpread: 10, cover: 0.5, count: 12 };
    const a = createClouds(fakeEngine(), 5, settings).positions();
    assert.deepEqual(createClouds(fakeEngine(), 5, settings).positions(), a);
    assert.notDeepEqual(createClouds(fakeEngine(), 6, settings).positions(), a);
  });

  it('sets the cloud base by Espy’s rule', () => {
    assert.equal(createClouds(fakeEngine(), 1, { dewSpread: 12, cover: 0.3, count: 1 }).base, 1500);
  });
});

describe('effects', () => {
  const emitter = (effect: Marker & { kind: 'emitter' }, count: number): Marker[] =>
    Array.from({ length: count }, (_, i) => ({ ...effect, name: `${effect.name}-${i}` }));
  const sand = {
    kind: 'emitter',
    effect: 'sand',
    name: 'dune',
    position: [0, 0, 0],
    radius: 20,
  } as const;
  const make = (markers: Marker[], movers: Mover[] = []) =>
    createEffects(fakeEngine(), {}, { seed: 3, markers, movers, pixelAngle: 1e-3, limit: 50_000 });

  it('holds a kind within its capacity however many emitters ask', () => {
    const effects = make(emitter(sand, 400));
    for (let frame = 0; frame < 300; frame++) effects.update(1 / 60, [0, 2, 0], wind(), 0);
    assert.equal(effects.system('sand').pool.alive, PRESETS.sand.capacity);
  });

  it('runs an emitter only within reach of the camera', () => {
    const effects = make(emitter(sand, 1));
    for (let frame = 0; frame < 60; frame++) effects.update(1 / 60, [40_000, 0, 0], wind(), 0);
    assert.equal(effects.system('sand').pool.alive, 0);
  });

  it('wakes fireflies at night only', () => {
    const flies = { ...sand, effect: 'fireflies', name: 'field' } as const;
    const day = make(emitter(flies, 1));
    const night = make(emitter(flies, 1));
    for (let frame = 0; frame < 120; frame++) {
      day.update(1 / 60, [0, 0, 0], wind(), 0);
      night.update(1 / 60, [0, 0, 0], wind(), 1);
    }
    assert.equal(day.system('fireflies').pool.alive, 0);
    assert.ok(night.system('fireflies').pool.alive > 0);
  });

  it('declares heat haze and neon glow as waiting on post-processing', () => {
    const haze = { ...sand, effect: 'heat-haze', name: 'road' } as const;
    assert.equal(make(emitter(haze, 2)).pending.length, 2);
  });
});

describe('sky', () => {
  it("runs a whole day on the page's world: lights, exposure, night and rain", () => {
    const engine = fakeEngine();
    type Hook = (frame: { delta: number }) => void;
    const frames: Hook[] = [];
    const scene = { ...engine.object.group(), background: null, fog: null, environment: null };
    const camera = { ...engine.object.group(), far: 60_000, fov: 50 };
    const world = {
      scene,
      camera,
      exposure: 1,
      onFrame: (hook: Hook) => frames.push(hook),
      invalidate() {},
    };
    const sky = createSky({
      world,
      engine,
      seed: 332,
      size: 50_000,
      tile: 1_000,
      speed: 60,
    } as never);
    const seen = new Set<boolean>();
    sky.rain.amount = 1;
    for (let second = 0; second < 30; second++) {
      frames[0]({ delta: 1 });
      seen.add(sky.isNight);
      assert.ok(Number.isFinite(world.exposure) && world.exposure > 0);
      assert.ok(sky.nightFactor >= 0 && sky.nightFactor <= 1);
    }
    assert.deepEqual([...seen].sort(), [false, true]);
    assert.ok(sky.rain.node.visible);
    assert.equal(sky.lampIntensity({ night: false, intensity: 5 } as never), 5);
  });
});
