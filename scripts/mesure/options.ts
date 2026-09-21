// Options, harness views, and server mounts for `banc.ts`.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { VIEWS } from './poses.ts';
import { ASSETS } from './scene.ts';
import { lightingSettings } from './optionsEclairage.ts';
import type { SideBase } from './dists.ts';

export { PATH_VERSION, VIEWS, poseAt } from './poses.ts';
export { applySceneFlag, assetsManifest, sceneGltf, sceneOf, scenesOf } from './scene.ts';
export { resolveSides } from './dists.ts';
export { ENGINES, engineOf, equipSide, resolveCache, sideReport } from './optionsCote.ts';
import { ENGINES } from './optionsCote.ts';

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
export function resolveMounts(root: string, sides: SideBase[], resources: string | null) {
  return [
    { prefix: '/vendor/three/', dir: packageDir(root, 'three') },
    // Modules imported by the page via URL: `pageCoupe.ts`, `pageTemoin.ts`.
    { prefix: '/mesure/', dir: join(root, 'scripts/mesure') },
    { prefix: '/vendor/meshoptimizer/', dir: packageDir(root, 'meshoptimizer') },
    { prefix: '/benchmark-assets/', dir: ASSETS },
    ...(resources ? [{ prefix: '/assets/', dir: resources }] : []),
    ...sides.map((side) => ({ prefix: `/sdk/${side.name}/`, dir: side.dist })),
    ...sides
      .filter((side): side is SideBase & { cache: string } => Boolean(side.cache))
      .map((side) => ({ prefix: `/cache/${side.name}/`, dir: side.cache })),
  ].map((mount) => ({ ...mount, dir: resolve(mount.dir) }));
}

/** Command line `--name value` / `--name=value` arguments. Shared by harnesses:
 *  a single place knows what a flag means, and a missing value defaults to `'true'`. */
export function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const eq = arg.indexOf('=');
    if (eq > 0) flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags.set(arg.slice(2), argv[++i]);
    else flags.set(arg.slice(2), 'true');
  }
  return flags;
}

/** In-session memory budgets, or `null` when none requested. */
function live(flags: Map<string, string>, mio: (name: string) => number | null) {
  const budgets = {
    geometryPoolBytes: flags.has('pool-geometrie-vivant')
      ? mio('pool-geometrie-vivant')
      : undefined,
    texturePoolBytes: flags.has('pool-textures-vivant') ? mio('pool-textures-vivant') : undefined,
  };
  return Object.values(budgets).some((v) => v !== undefined) ? budgets : null;
}

/** Math calculation path forced for the campaign, or `auto`: governor arbitrates then. */
function mathPathOf(flags: Map<string, string>) {
  const value = flags.get('chemin-math') ?? 'auto';
  if (value !== 'auto' && value !== 'js' && value !== 'wasm')
    throw new Error('--chemin-math must be auto, js or wasm');
  return value;
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
  const engine = flags.get('moteur') ?? 'webgl';
  if (!ENGINES[engine]) throw new Error(`--moteur must be ${Object.keys(ENGINES).join(', ')}`);
  const views = (flags.get('vues') ?? 'generale,sol,rue').split(',').filter(Boolean);
  for (const view of views) if (!VIEWS[view as keyof typeof VIEWS]) throw new Error(`unknown view: ${view}`);
  const pixelErrors = String(flags.get('pixelError') ?? '0')
    .split(',')
    .filter(Boolean)
    .map((value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--pixelError invalid: ${value}`);
      return parsed;
    });
  const settings = {
    engine,
    frames: number('images', 60),
    warmup: number('chauffe', 8),
    pixelErrors,
    // `--max-pages`: a limit in PAGES on the geometry pool, for test scenes; without it,
    // pool is the engine byte pool. `--pool-geometrie` and `--pool-textures` specify pools in MiB;
    // when absent, the engine retains its 512 MiB default.
    maxPages: flags.has('max-pages') ? number('max-pages', 0) : null,
    geometryPoolBytes: mioSi('pool-geometrie'),
    texturePoolBytes: mioSi('pool-textures'),
    // `--pool-geometrie-plafond`: maximum pool that an in-session setting may request.
    geometryPoolCeilingBytes: mioSi('pool-geometrie-plafond'),
    // `--pool-geometrie-vivant` / `--pool-textures-vivant`: same pools, but adjusted IN
    // SESSION after warmup via `explorer.setMemoryBudgets` — like an application slider.
    poolVivant: live(flags, mioSi),
    width: number('largeur', 1280),
    height: number('hauteur', 720),
    port: number('port', 0),
    // `--profil off` replays the same series without per-stage timing: fidelity gate.
    stageProfile: (flags.get('profil') ?? 'on') !== 'off',
    // A breakdown campaign puts "trace" details on BOTH sides, including the one without variants.
    trace: [...flags.keys()].some((name) => name === 'variante' || name.startsWith('variante-')),
    profileFrames: number('images-profil', 120),
    // `--textures cache`: the engine reads baked texture levels from cache; loader does not open source images.
    textureSource: flags.get('textures') === 'cache' ? 'cache' : 'host',
    // `--budget-textures <ms>`: CPU milliseconds a frame may spend copying texture tiles; without
    // the option, the engine keeps its default (1.0 ms).
    textureUploadMs: flags.has('budget-textures') ? number('budget-textures', 1) : null,
    // `--antialiasing off`: WebGPU engine renders without jitter or history.
    temporalAntialiasing: flags.get('antialiasing') !== 'off',
    // Headless mode caps display to 60 Hz on this machine: `--visible` opens a real window when frame rate matters.
    visible: flags.get('visible') === 'true',
    ...lightingSettings(flags, number),
    // `--camera-mobile` advances position along benchmark trajectory for each measured frame.
    movingCamera: flags.get('camera-mobile') === 'true',
    // `--instances`: number of object copies placed in a grid by the SDK.
    instances: number('instances', 1),
    // `--isolation on` sets COOP/COEP on the harness server: page becomes cross-origin isolated.
    isolation: (flags.get('isolation') ?? 'off') === 'on',
    // `--chemin-math js|wasm` forces batch calculation path for entire campaign.
    mathPath: mathPathOf(flags),
  };
  const isolation = flags.get('isolation') ?? 'off';
  if (isolation !== 'on' && isolation !== 'off') throw new Error('--isolation must be on or off');
  if (![1, 4, 9, 12].includes(settings.instances))
    throw new Error('--instances must be 1, 4, 9 or 12');
  if (settings.lights < 0) throw new Error('--lampes must be a non-negative integer');
  if (settings.frames < 1) throw new Error('--images must be a positive integer');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = resolve(flags.get('out') ?? join(root, '.mesure/out', `${engine}-${stamp}`));
  // `--ressources`: base path referenced by compiled cache glTF via relative path, mounted under `/assets/`.
  const resourcesDir = flags.get('ressources');
  return { flags, settings, views, out, resources: resourcesDir ? resolve(resourcesDir) : null };
}
