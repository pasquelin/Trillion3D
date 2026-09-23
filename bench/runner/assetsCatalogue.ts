// The public models the proofs and the bench run on, and where they come from.
//
// Every one of them is published by Khronos under the terms its own `README.md` carries, fetched
// from the official repository at the commit `git clone --depth 1` returns, and never edited here:
// a source folder under `.mesure/assets/<scene>/` is read-only, the compiled cache it feeds goes to
// `.mesure/assets/<scene>-derived/` (`README.md` § Assets).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SAMPLE_REPOSITORY = 'https://github.com/KhronosGroup/glTF-Sample-Assets';

/**
 * What each model is kept for. The bench's reference scenes are the first two (`scene.ts`); the
 * others are the small cases a proof points at when it needs one thing and nothing else.
 */
export const SAMPLE_MODELS: Record<string, string> = {
  Sponza: 'interior, the big cut, the sun and its shadows',
  DamagedHelmet: 'one textured object, a whole PBR set on a single primitive',
  SciFiHelmet: 'one object, separate maps, a tangent frame from the source',
  FlightHelmet: 'many small primitives and many materials on one object',
  ABeautifulGame: 'thin geometry, transparency and polished metal on one board',
  Lantern: 'a few primitives, an emissive material',
  Duck: 'the smallest complete scene: one mesh, one image',
  Suzanne: 'untextured, dense and closed: topology without materials',
  MetalRoughSpheres: 'the metal/roughness grid, one primitive per cell',
  NormalTangentMirrorTest: 'mirrored texture coordinates: a fold the weld must not split',
  TextureCoordinateTest: 'texture-coordinate layouts read straight off the image',
  AlphaBlendModeTest: 'the three alpha modes side by side',
};

/** `SciFiHelmet` → `sci-fi-helmet`, `ABeautifulGame` → `abeautiful-game`. */
export const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Scene folder name of each catalogue model, in catalogue order. */
export const catalogueScenes = () => Object.keys(SAMPLE_MODELS).map(kebab);

/** The `.gltf` a source folder carries, or `null`: a folder is a scene only once it has one. */
export function sceneGltfFile(directory: string) {
  if (!existsSync(directory)) return null;
  return readdirSync(directory).find((file) => file.endsWith('.gltf')) ?? null;
}

/**
 * Every scene on disk: a folder of `assets` that is not a `-derived` cache and carries a `.gltf`.
 * Catalogue models come first, in catalogue order, then whatever else was generated there — a
 * facade scene (`scenes/facade.ts`), or a model someone dropped in by hand.
 */
export function scenesOnDisk(assets: string) {
  if (!existsSync(assets)) return [];
  const known = catalogueScenes();
  const found = readdirSync(assets, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith('-derived'))
    .map((entry) => entry.name)
    .filter((name) => sceneGltfFile(join(assets, name)) !== null);
  return [
    ...known.filter((name) => found.includes(name)),
    ...found.filter((name) => !known.includes(name)).sort(),
  ];
}
