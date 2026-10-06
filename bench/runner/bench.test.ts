import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCENE, FLUIDS_SCENE, sceneOf } from './assets/scene.ts';
import { CAMPAIGN, BASE } from './campaign.ts';
import {
  ENGINES,
  engineOf,
  equipSide,
  equipSides,
  parseArgs,
  poseAt,
  readOptions,
  trajectoryPoses,
} from './options.ts';

test('readOptions parses command line arguments correctly', () => {
  const root = '/tmp/test';

  // Test default engine (webgl)
  const result1 = readOptions([], root);
  assert.strictEqual(result1.settings.engine, 'webgl');
  assert.strictEqual(result1.settings.dpr, 1);

  // Test setting engine to webgpu
  const result2 = readOptions(['--engine=webgpu'], root);
  assert.strictEqual(result2.settings.engine, 'webgpu');

  // Test views parsing
  const result3 = readOptions(['--views=overview,detail'], root);
  assert.deepStrictEqual(result3.views, ['overview', 'detail']);

  // Test numeric arguments
  const result4 = readOptions(['--images=120', '--width=1920', '--height=1080'], root);
  assert.strictEqual(result4.settings.frames, 120);
  assert.strictEqual(result4.settings.width, 1920);
  assert.strictEqual(result4.settings.height, 1080);

  // Test pixelError parsing
  const result5 = readOptions(['--pixelError=0.5,1.0,2.0'], root);
  assert.deepStrictEqual(result5.settings.pixelErrors, [0.5, 1.0, 2.0]);

  assert.strictEqual(readOptions(['--dpr=2'], root).settings.dpr, 2);
  for (const value of ['0', '-1', 'NaN'])
    assert.throws(() => readOptions([`--dpr=${value}`], root), /--dpr/);
});

test('readOptions rejects unknown engine', () => {
  const root = '/tmp/test';
  assert.throws(() => readOptions(['--engine=unknown'], root), /--engine must be/);
});

test('readOptions accepts an explicit port', () => {
  const root = '/tmp/test';
  const result = readOptions(['--port=3000'], root);
  assert.strictEqual(result.settings.port, 3000);
});

test('readOptions rejects non-numeric arguments', () => {
  const root = '/tmp/test';
  assert.throws(() => readOptions(['--images=abc'], root), /--images must be a number/);
});

test('readOptions rejects negative pixelError', () => {
  const root = '/tmp/test';
  assert.throws(() => readOptions(['--pixelError=-1.0'], root), /--pixelError invalid/);
});

test('readOptions rejects invalid views', () => {
  const root = '/tmp/test';
  assert.throws(() => readOptions(['--views=invalide'], root), /unknown view/);
});

test('sceneOf deduces the scene name from the cache derived directory', () => {
  assert.strictEqual(sceneOf('/quelque/part/bistro-exterior-derived'), 'bistro-exterior');
  assert.strictEqual(sceneOf('/quelque/part/bistro-exterior-derived/'), 'bistro-exterior');
  assert.strictEqual(sceneOf('/quelque/part/new-york-manhattan-derived'), 'new-york-manhattan');
});

test('sceneOf keeps the directory name when it does not end with -derived', () => {
  assert.strictEqual(sceneOf('/quelque/part/un-cache-a-moi'), 'un-cache-a-moi');
});

test('sceneOf falls back to the default scene without a named cache', () => {
  assert.strictEqual(sceneOf(undefined), DEFAULT_SCENE);
  assert.strictEqual(sceneOf(''), DEFAULT_SCENE);
});

// `--instances`: the number of copies that the SDK places in a grid. Only one by default, and only
// grids that `replicateInstances` knows how to place are accepted.
test('readOptions reads --instances and rejects a grid that the SDK cannot place', () => {
  const root = '/tmp/test';
  assert.strictEqual(readOptions([], root).settings.instances, 1);
  assert.strictEqual(readOptions(['--instances=9'], root).settings.instances, 9);
  assert.throws(() => readOptions(['--instances=3'], root), /--instances/);
});

test('engineOf gives a side its own engine, otherwise that of the campaign', () => {
  const flags = parseArgs(['--engine-before', 'webgl']);
  assert.strictEqual(engineOf(flags, 'before', 'webgpu').id, 'exact-cluster-pages');
  assert.strictEqual(engineOf(flags, 'after', 'webgpu').id, 'webgpu-page-raster');
});

// #724: the flags a campaign types are English, their per-side forms named after the side.
test('the engine, the two sides and their variants are read under English flags', () => {
  const argv = ['--engine', 'webgpu', '--before', 'dist', '--engine-before', 'webgl'];
  const { settings, flags } = readOptions([...argv, '--variant-before', 'raster-compute'], '/r');
  assert.strictEqual(settings.engine, 'webgpu');
  assert.strictEqual(flags.get('before'), 'dist');
  assert.strictEqual(
    equipSide({ name: 'before' } as never, flags, settings).variant,
    'raster-compute',
  );
});

/** What `bench.ts` reads before it builds anything, then its refusal of the rest. */
function benchFlags(argv: string[]) {
  const { settings, flags } = readOptions(argv, '/r');
  equipSides(flags, settings, '/nowhere');
  flags.refuseUnread();
}

// #724: a retired or misspelt flag is refused by name, never measured as the default engine.
test('the bench refuses a flag it never reads, the retired French ones included', () => {
  const retired = '--moteur';
  assert.throws(
    () => benchFlags([retired, 'webgpu', '--before', 'dist', '--varaint', 'x']),
    new RegExp(`^Error: unknown flag: ${retired}, --varaint$`),
  );
  // A side flag for a side the run does not measure changes nothing either.
  assert.throws(() => benchFlags(['--engine-before', 'webgl']), /--engine-before/);
  for (const [name, , args] of CAMPAIGN) {
    const argv = [...BASE.split(' '), '--scene', FLUIDS_SCENE, ...args];
    assert.doesNotThrow(() => benchFlags(argv), name);
  }
});

test('engineOf rejects an unknown engine for a side', () => {
  assert.throws(
    () => engineOf(parseArgs(['--engine-after', 'inconnu']), 'after', 'webgl'),
    /--engine-after must be/,
  );
});

test('only engines rendering through Three receive lights placed by the host', () => {
  assert.strictEqual(ENGINES.webgl.three, true);
  assert.strictEqual(ENGINES.webgl2.three, true);
  assert.strictEqual(ENGINES.webgpu.three, undefined);
});

test('--gaze-network is a recorded setting that requires baked cache textures', () => {
  const root = '/tmp/test';
  assert.strictEqual(readOptions([], root).settings.gazeNetwork, false);
  assert.strictEqual(
    readOptions(['--gaze-network', '--textures', 'cache'], root).settings.gazeNetwork,
    true,
  );
  assert.throws(
    () => readOptions(['--gaze-network'], root),
    /--gaze-network requires --textures cache/,
  );
});

test('trajectoryPoses plays one pose per frame from the view index', () => {
  const bounds = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 1, z: 1 } };
  const poses = trajectoryPoses(bounds, 3, 4);
  assert.strictEqual(poses.length, 4);
  assert.deepStrictEqual(poses[0], poseAt(bounds, 3));
  assert.deepStrictEqual(poses[3], poseAt(bounds, 6));
});
