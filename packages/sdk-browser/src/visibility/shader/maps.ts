import { WRAP_MAP } from '../wrapModes.ts';
import type { MaterialClassFeature } from './materialClass.ts';

/**
 * What each `WRAP_MAP` map gives its read: its slot in the page record. A rank added to
 * `WRAP_MAP` without its entry here does not compile; without this table, a seventh map would
 * be read in clamp without anything signalling it.
 */
const CARTE = {
  base: 'mapIndex',
  rough: 'roughnessIndex',
  metal: 'metalnessIndex',
  normal: 'normalIndex',
  ao: 'aoIndex',
  emissive: 'emissiveIndex',
} as const satisfies Record<keyof typeof WRAP_MAP, string>;

/** Atlas read of a map: its slot — whose header carries its addressing — and the pixel's
 *  derivatives. */
export const lecture = (fn: string, nom: keyof typeof WRAP_MAP) =>
  `${fn}(page.${CARTE[nom]},uv,ddx,ddy)`;

/** Class override that says the map exists (`materialClass.ts`): slot 0 is the absence
 *  of a texture, and every page of a class has the same maps, so the test folds at compile time. */
const PRESENCE = {
  base: 'HAS_MAP',
  rough: 'HAS_ROUGH',
  metal: 'HAS_METAL',
  normal: 'HAS_NORMAL_MAP',
  ao: 'HAS_AO',
  emissive: 'HAS_EMISSIVE',
} as const satisfies Record<keyof typeof WRAP_MAP, MaterialClassFeature>;

/** The body runs only if the class reads the map. */
export const siCarte = (nom: keyof typeof WRAP_MAP, corps: string) =>
  `if(${PRESENCE[nom]}){${corps}}`;

/**
 * Read of a data map that may be the SAME texture as a map already read — a glTF stores
 * roughness, metal and occlusion in one image, its addressing with it —: the already-read value
 * is reused as-is, bit for bit, instead of redoing the pool indirection chain. The result is
 * the same as three reads; only the cost changes (2.8 → 6.5 ms of materials pass at
 * 2496×1404 on Emerald when each map reread its table).
 */
export const lectureDonnee = (
  variable: string,
  nom: keyof typeof WRAP_MAP,
  dejaLues: readonly [variable: string, nom: keyof typeof WRAP_MAP][],
) => {
  const reprises = dejaLues
    .map(([lue, autre]) => `if(page.${CARTE[nom]}==page.${CARTE[autre]}){${variable}=${lue};}else `)
    .join('');
  return siCarte(nom, `${reprises}{${variable}=${lecture('dataSample', nom)};}`);
};
