// Bench reference scenes, and the cache that carries them. The engine names no scene: the harness
// infers the name from the cache, and the campaign plays these when none is given.
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// Bench assets, read-only: `<scene>/` (sources) and `<scene>-derived/` (compiled cache, see
// `README.md` § Assets) under `.mesure/assets/` of the repo, off git. `WG_ASSETS` points at
// another folder — a frozen copy, or that of another worktree.
export const ASSETS = process.env.WG_ASSETS
  ? resolve(process.env.WG_ASSETS)
  : resolve(import.meta.dirname, '../../.mesure/assets');

/** Harness fallback when no named cache gives it a scene. */
export const DEFAULT_SCENE = 'emerald-square';

/** The two scenes the campaign plays, in this order, as soon as their cache is there. */
export const REFERENCE_SCENES = ['emerald-square', 'whisperwind-village'];

/** What the report must say of a scene, and that a reading does not carry. */
const SCENE_NOTES = {
  'whisperwind-village':
    'Unreal FBX, heavy instancing (one wall × 1,292). 81 materials, 6 textured: the export omitted Megascans textures — not on us; re-export from Unreal.',
};

export const sceneNote = (scene) => SCENE_NOTES[scene] ?? null;

export const sceneDerived = (scene, assets = ASSETS) => join(assets, `${scene}-derived`);

const cachePret = (scene, assets) =>
  existsSync(join(sceneDerived(scene, assets), 'native/full/manifest.json'));

/** Scenes of a campaign: `--scene a,b`, otherwise the references whose cache is ready. */
export function scenesOf(flags, assets = ASSETS) {
  const raw = flags.get('scene');
  if (raw && raw !== 'true') return raw.split(',').filter(Boolean);
  return REFERENCE_SCENES.filter((scene) => cachePret(scene, assets));
}

/** `--scene nom` sets the assets cache on each side that does not have its own. */
export function applySceneFlag(flags, assets = ASSETS) {
  const scene = flags.get('scene');
  if (!scene || scene === 'true') return;
  const derived = sceneDerived(scene, assets);
  if (!flags.has('cache-apres')) flags.set('cache-apres', derived);
  if (flags.has('avant') && !flags.has('cache-avant')) flags.set('cache-avant', derived);
}

/** Scene name of a side, inferred from the cache: the "derived" folder carries `<name>-derived`. */
export function sceneOf(cache) {
  if (!cache) return DEFAULT_SCENE;
  const name = basename(resolve(cache));
  return name.endsWith('-derived') ? name.slice(0, -'-derived'.length) : name;
}

/** Manifest URL of an assets scene cache. Required only if a side reads it. */
export function assetsManifest(scene, needed) {
  if (needed && !cachePret(scene, ASSETS)) throw new Error(`cache absent : ${sceneDerived(scene)}`);
  return `/benchmark-assets/${scene}-derived/native/full/manifest.json`;
}

/**
 * glTF URL of the Three witness: the sources file, otherwise `source.gltf` written by the
 * compiler next to the cache — an FBX has no glTF in the source folder.
 */
export function gltfUrlIn(assets, scene) {
  const dossier = join(assets, scene);
  const gltf = existsSync(dossier) ? readdirSync(dossier).find((f) => f.endsWith('.gltf')) : null;
  if (gltf) return `/benchmark-assets/${scene}/${gltf}`;
  const full = join(sceneDerived(scene, assets), 'native/full');
  if (existsSync(full))
    for (const key of readdirSync(full))
      if (existsSync(join(full, key, 'source.gltf')))
        return `/benchmark-assets/${scene}-derived/native/full/${key}/source.gltf`;
  throw new Error(`glTF source absent : ${dossier}`);
}

export const sceneGltf = (scene) => gltfUrlIn(ASSETS, scene);
