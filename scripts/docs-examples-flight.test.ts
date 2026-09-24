import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Quaternion } from '../packages/sdk-core/src/world/math/quaternion.ts';

type Surface = [number, number, number, number, number, number, boolean];
type Ground = ((x: number, z: number, key?: string) => [number, boolean]) & {
  ready(): boolean;
  reset(): void;
  send(): void;
};

/** One function of the flight example, taken from the page as it is served. */
async function pageFunction<T>(name: string): Promise<T> {
  const html = await readFile(
    new URL('../site/examples/fly-over-a-model-town.html', import.meta.url),
    'utf8',
  );
  const source = new RegExp(`\\n( *)function ${name}\\([\\s\\S]*?\\n\\1}\\n`).exec(html)?.[0];
  assert.ok(source, name);
  return new Function(`${source}; return ${name};`)() as T;
}

/** The probes over a ground that answers on demand, with the questions it was asked. */
async function probesOver(answer: (x: number, z: number, reach: number) => Surface[]) {
  const asked: [number, number, number][] = [];
  const pending: (() => void)[] = [];
  const groundProbes = await pageFunction<(ask: unknown) => Ground>('groundProbes');
  const ground = groundProbes(
    (x: number, z: number, reach: number) =>
      new Promise<Surface[]>((resolve) => {
        asked.push([x, z, reach]);
        pending.push(() => resolve(answer(x, z, reach)));
      }),
  );
  const settle = async () => {
    for (const resolve of pending.splice(0)) resolve();
    await new Promise(setImmediate);
  };
  return { ground, asked, settle };
}

// A slope rising half a metre per metre eastwards, landable nowhere.
const slope = (x: number, z: number): Surface[] => {
  const n = Math.hypot(0.5, 1);
  return [[x, 0.5 * x, z, -0.5 / n, 1 / n, 0, false]];
};

test('the flight ground reads no ground and holds the jet until the physics has answered under it', async () => {
  const { ground, settle } = await probesOver(slope);
  assert.deepEqual(ground(10, 0), [-Infinity, false]);
  assert.equal(ground.ready(), false);
  ground.send();
  await settle();
  assert.equal(ground.ready(), true);
  assert.deepEqual(ground(10, 0), [5, false]);
  ground.reset();
  assert.equal(ground.ready(), false);
});

test('each ground probe asks where it will be a frame on, one question in flight, and carries its answer along the surface', async () => {
  const { ground, asked, settle } = await probesOver(slope);
  ground(10, 0);
  ground.send();
  ground(12, 0);
  ground.send(); // The first question is still in flight: none more.
  assert.deepEqual(asked, [[10, 0, 1]]);
  await settle();
  ground(14, 0);
  ground.send();
  assert.deepEqual(asked[1], [16, 0, 5]);
  await settle();
  // The answer at 16 m, carried along its plane to 17 m: the slope's height there.
  assert.ok(Math.abs(ground(17, 0)[0] - 8.5) < 1e-9);
  // An answered miss is no ground.
  const none = await probesOver(() => []);
  none.ground(0, 0);
  none.ground.send();
  await none.settle();
  assert.equal(none.ground.ready(), true);
  assert.deepEqual(none.ground(0, 0), [-Infinity, false]);
});

test('the jet never reads the ground under a roof it is over, even when the answers come a frame late', async () => {
  // Flat ground, and a roof 10 m high from x = 20 m on. A ray answers the point asked; a reach
  // answers, too, the highest ground within it, as the physics' box sweep does.
  const height = (x: number) => (x >= 20 ? 10 : 0);
  const surface = (x: number, z: number): Surface => [x, height(x), z, 0, 1, 0, false];
  for (const late of [1, 2]) {
    const { ground, settle } = await probesOver((x, z, reach) =>
      reach > 0
        ? [surface(x, z), surface(Math.max(x, Math.min(x + reach, 20)), z)]
        : [surface(x, z)],
    );
    for (let frame = 0, x = 0; x < 40; frame++, x += 4) {
      const [floor] = ground(x, 0);
      if (ground.ready()) assert.ok(floor >= height(x), `late ${late}, x ${x}: ${floor}`);
      ground.send();
      if (frame % late === 0) await settle();
    }
  }
});

test("the chase camera's blend is the normalised blend of the two turns it was before the engine's quaternions", async () => {
  const blendTurn =
    await pageFunction<(a: Quaternion, b: Quaternion, t: number) => Quaternion>('blendTurn');
  const turn = (x: number, y: number, z: number, angle: number) => {
    const n = Math.hypot(x, y, z);
    return new Quaternion().setFromAxisAngle({ x: x / n, y: y / n, z: z / n }, angle);
  };
  const cases: [Quaternion, Quaternion][] = [
    [turn(0, 1, 0, 0.1), turn(1, 0, 0, 2.5)],
    [turn(1, 2, 3, -1), turn(-3, 1, 0.5, 2.9)],
    [turn(0, 0, 1, 0.3), turn(0, 0, 1, 0.3 + 1e-9)],
  ];
  for (const [a, b] of cases)
    for (const t of [0.02, 0.3, 0.9]) {
      // The blend of before: component by component towards b's nearer sign, normalised.
      const sign = a.dot(b) < 0 ? -1 : 1;
      const mixed = ['x', 'y', 'z', 'w'].map((c) => {
        const k = c as 'x' | 'y' | 'z' | 'w';
        return a[k] + (sign * b[k] - a[k]) * t;
      });
      const length = Math.hypot(...mixed);
      const got = blendTurn(a.clone(), b, t);
      assert.ok(
        Math.abs(got.dot(new Quaternion(...(mixed as [number, number, number, number])))) >
          length * (1 - 1e-12),
        `t ${t}`,
      );
    }
});
