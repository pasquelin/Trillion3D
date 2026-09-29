// Options, harness views, and server mounts for `bench.ts`.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FRAMES_PER_SEGMENT, VIEWS } from './poses.ts';
import { ASSETS, applySceneFlag, sceneOf } from './scene.ts';
import { lightingSettings } from './lightingOptions.ts';
import type { SideBase } from './dists.ts';
import type { BenchSettings, LivePools } from './benchSettings.ts';
import { residentFraction } from './poolFill.ts';
export type { BenchSettings } from './benchSettings.ts';

export { PATH_VERSION, VIEWS, poseAt, trajectoryPoses } from './poses.ts';
export { assetsManifest, sceneGltf, scenesOf } from './scene.ts';
export { resolveSides, sdkEntryUrl } from './dists.ts';
export { ENGINES, engineOf, equipSide, resolveCache, sideReport } from './sideOptions.ts';
export { parseArgs } from './flags.ts';
import { type Flags, parseArgs } from './flags.ts';
import { ENGINES, equipSide } from './sideOptions.ts';

/** An installed package directory, searched like Node searches: root upwards.
 *  A worktree without its own `node_modules` thus finds those of the main worktree. */
function packageDir(root: string, name: string) {
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error(`package not found: ${name}`);
  }
}

/**
 * What the harness server serves, and nothing else: browser dependencies, benchmark assets,
 * dist of each side and its cache if it has one. `resources` is the folder referenced by relative path
 * (`assets/textures/...`) in a compiled cache glTF; without it, textures in a compiled cache yield 404.
 */
export function resolveMounts(root: string, sides: SideBase[], resources: string | null = null) {
  return [
    { prefix: '/vendor/three/', dir: packageDir(root, 'three') },
    // Modules imported by the page via URL: `cutPage.ts`, `witnessPage.ts`.
    { prefix: '/runner/', dir: join(root, 'bench/runner') },
    { prefix: '/vendor/meshoptimizer/', dir: packageDir(root, 'meshoptimizer') },
    { prefix: '/benchmark-assets/', dir: ASSETS },
    ...(resources ? [{ prefix: '/assets/', dir: resources }] : []),
    ...sides.map((side) => ({ prefix: `/sdk/${side.name}/`, dir: side.dist })),
    ...sides
      .filter((side): side is SideBase & { cache: string } => Boolean(side.cache))
      .map((side) => ({ prefix: `/cache/${side.name}/`, dir: side.cache })),
  ].map((mount) => ({ ...mount, dir: resolve(mount.dir) }));
}

/** In-session memory budgets, or `null` when none requested. The live texture pool takes MiB, or
 *  `<n>%` of the texture bytes the settled pose holds resident: a pool the scene fills. */
function live(flags: Map<string, string>, mio: (name: string) => number | null): LivePools | null {
  const TEXTURE = 'texture-pool-live';
  const texture = flags.get(TEXTURE),
    fraction = texture === undefined ? undefined : residentFraction(texture);
  const budgets = {
    geometryPoolBytes: flags.has('geometry-pool-live') ? mio('geometry-pool-live') : undefined,
    texturePoolBytes: texture !== undefined && fraction === undefined ? mio(TEXTURE) : undefined,
    textureResidentFraction: fraction,
  };
  return Object.values(budgets).some((v) => v !== undefined) ? budgets : null;
}

/** Math calculation path forced for the campaign, or `auto`: governor arbitrates then. */
function mathPathOf(flags: Map<string, string>) {
  const value = flags.get('math-path') ?? 'auto';
  if (value !== 'auto' && value !== 'js' && value !== 'wasm')
    throw new Error('--math-path must be auto, js or wasm');
  return value;
}

/** The bench's sides by name, equipped from their flags (`--scene` first names their caches):
 *  the candidate always, the reference only if `--before` names it. Their `dist` is resolved
 *  afterwards (`resolveSides`), so an unread flag is refused before any build. The measured scene
 *  is that of the named caches, otherwise the benchmark reference scene. */
export function equipSides(flags: Flags, settings: BenchSettings, assets: string = ASSETS) {
  const after = flags.get('after');
  const before = flags.get('before');
  applySceneFlag(flags, assets);
  const names = before ? ['after', 'before'] : ['after'];
  const sides = names.map((name) => equipSide({ name } as SideBase, flags, settings));
  const scene = sceneOf(sides.find((side) => side.cache)?.cache, flags.get('scene'));
  return { sides, scene, after, before };
}

/** Validated harness options: engine, views, error thresholds, settings, output directory. */
export function readOptions(argv: string[], root: string) {
  const flags = parseArgs(argv);
  const number = (name: string, fallback: number) => {
    const value = Number(flags.get(name) ?? fallback);
    if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
    return value;
  };
  /** An option in MiB, or `null` when omitted. */
  const mioSi = (name: string) => {
    if (!flags.has(name)) return null;
    const value = number(name, 0);
    if (!(value > 0)) throw new Error(`--${name} must be a strictly positive number of MiB`);
    return Math.round(value * 1024 * 1024);
  };
  const engine = flags.get('engine') ?? 'webgl';
  if (!ENGINES[engine]) throw new Error(`--engine must be ${Object.keys(ENGINES).join(', ')}`);
  const views = (flags.get('views') ?? 'generale,sol,rue')
    .split(',')
    .filter(Boolean) as (keyof typeof VIEWS)[];
  for (const view of views) if (!VIEWS[view]) throw new Error(`unknown view: ${view}`);
  const pixelErrors = String(flags.get('pixelError') ?? '0')
    .split(',')
    .filter(Boolean)
    .map((value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--pixelError invalid: ${value}`);
      return parsed;
    });
  const dpr = number('dpr', 1);
  if (!(dpr > 0)) throw new Error('--dpr must be a strictly positive number');
  const settings: BenchSettings = {
    engine,
    // A moving run covers one trajectory segment by default.
    frames: number('images', FRAMES_PER_SEGMENT),
    warmup: number('warmup', 8),
    pixelErrors,
    // `--max-pages`: a limit in PAGES on the geometry pool, for test scenes; without it,
    // pool is the engine byte pool. `--geometry-pool` and `--texture-pool` specify pools in MiB;
    // when absent, the engine retains its 512 MiB default.
    maxPages: flags.has('max-pages') ? number('max-pages', 0) : null,
    geometryPoolBytes: mioSi('geometry-pool'),
    texturePoolBytes: mioSi('texture-pool'),
    // `--geometry-pool-ceiling`: maximum pool that an in-session setting may request.
    geometryPoolCeilingBytes: mioSi('geometry-pool-ceiling'),
    // `--geometry-pool-live` / `--texture-pool-live`: same pools, but adjusted IN
    // SESSION after warmup via `explorer.setMemoryBudgets` — like an application slider.
    poolVivant: live(flags, mioSi),
    width: number('width', 1280),
    height: number('height', 720),
    dpr,
    port: number('port', 0),
    // `--profile off` replays the same series without per-stage timing: fidelity gate.
    stageProfile: (flags.get('profile') ?? 'on') !== 'off',
    // A breakdown campaign puts "trace" details on BOTH sides, including the one without variants.
    trace: [...flags.keys()].some((name) => name === 'variant' || name.startsWith('variant-')),
    profileFrames: number('profile-frames', 120),
    // `--textures cache`: the engine reads baked texture levels from cache; loader does not open source images.
    textureSource: flags.get('textures') === 'cache' ? 'cache' : 'host',
    // `--texture-budget <ms>`: CPU milliseconds a frame may spend copying texture tiles; without
    // the option, the engine keeps its default (1.0 ms).
    textureUploadMs: flags.has('texture-budget') ? number('texture-budget', 1) : null,
    // `--antialiasing off`: WebGPU engine renders without jitter or history.
    temporalAntialiasing: flags.get('antialiasing') !== 'off',
    // Headless mode caps display to 60 Hz on this machine: `--visible` opens a real window when frame rate matters.
    visible: flags.get('visible') === 'true',
    ...lightingSettings(flags, number),
    // `--moving-camera` advances position along benchmark trajectory for each measured frame.
    movingCamera: flags.get('moving-camera') === 'true',
    // `--gaze-network`: plays each trajectory once without settle barrier and reads network bytes.
    gazeNetwork: flags.get('gaze-network') === 'true',
    // `--instances`: number of object copies placed in a grid by the SDK.
    instances: number('instances', 1),
    // `--isolation on` sets COOP/COEP on the harness server: page becomes cross-origin isolated.
    isolation: (flags.get('isolation') ?? 'off') === 'on',
    // `--math-path js|wasm` forces batch calculation path for entire campaign.
    mathPath: mathPathOf(flags),
  };
  const isolation = flags.get('isolation') ?? 'off';
  if (isolation !== 'on' && isolation !== 'off') throw new Error('--isolation must be on or off');
  if (![1, 4, 9, 12].includes(settings.instances))
    throw new Error('--instances must be 1, 4, 9 or 12');
  if (settings.lights < 0) throw new Error('--lights must be a non-negative integer');
  if (settings.frames < 1) throw new Error('--images must be a positive integer');
  if (settings.gazeNetwork && settings.textureSource !== 'cache')
    throw new Error('--gaze-network requires --textures cache');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = resolve(flags.get('out') ?? join(root, '.mesure/out', `${engine}-${stamp}`));
  // `--resources`: base path referenced by compiled cache glTF via relative path, mounted under `/assets/`.
  const resourcesDir = flags.get('resources');
  return { flags, settings, views, out, resources: resourcesDir ? resolve(resourcesDir) : null };
}
