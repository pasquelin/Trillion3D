import { BOUNCE_SETTINGS, type BounceCascades } from '../sdk-core/index.ts';

/** Mots de quatre octets d'un niveau dans l'uniforme : deux `vec4f`, origine et maille de base. */
const LEVEL_WORDS = 8;
/** Mots d'en-tête : portée et vue de diagnostic, tailles de la cascade, état de l'image. */
const HEADER_WORDS = 12;

/**
 * Octets de `BounceGrid`, unique source de vérité : cet uniforme, la structure WGSL que les trois
 * nuanceurs du rebond déclarent, et le tampon de remplacement que lit une image sans rebond ont
 * tous la même taille. Un niveau de cascade ajouté la fait grandir des trois côtés à la fois, et
 * jamais d'un seul — un remplaçant plus petit que la structure fait échouer la liaison, donc perdre
 * l'appareil, et c'est exactement ce qu'un nombre écrit à la main a déjà coûté.
 */
export const BOUNCE_GRID_BYTES = (HEADER_WORDS + BOUNCE_SETTINGS.cascadeLevels * LEVEL_WORDS) * 4;

/**
 * L'uniforme que les trois nuanceurs du rebond partagent : la passe de sondes, celle du cache de
 * surfaces et la résolution différée lisent la même description des cascades, au même rang.
 *
 * Il est écrit une fois à la construction pour ce qui ne bouge jamais — portée, tailles — et une
 * fois par image encodée pour ce qui bouge : les mailles de base des niveaux qui suivent la caméra,
 * et le lot que chacun reçoit. La résolution différée le relit à chaque image, même convergée,
 * quand plus aucune passe n'est encodée : c'est pourquoi il n'est jamais remis à zéro.
 */
export function createBounceUniform(device: GPUDevice, cascades: BounceCascades) {
  // L'uniforme porte toujours le nombre de niveaux déclaré, même quand la scène en tient moins :
  // la taille du tableau est une constante du nuanceur, et `counts.y` dit combien sont réels.
  const packed = new ArrayBuffer(BOUNCE_GRID_BYTES);
  const floats = new Float32Array(packed),
    integers = new Uint32Array(packed);
  const buffer = device.createBuffer({
    label: 'WG bounce cascades v1',
    size: packed.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  floats[0] = cascades.reach;
  integers.set(
    [cascades.size, cascades.levels.length, cascades.probesPerLevel, cascades.probes],
    4,
  );
  const upload = () => device.queue.writeBuffer(buffer, 0, packed);
  upload();
  let view = false;
  return {
    buffer,
    bytes: packed.byteLength,
    /** La vue de diagnostic d'irradiance : elle voyage dans le même uniforme que les cascades. */
    setIrradianceView(on: boolean) {
      if (view === on) return;
      view = on;
      floats[1] = on ? 1 : 0;
      upload();
    },
    /** L'état de l'image encodée : révision des lampes, groupes lancés, compteur d'images, niveaux. */
    write(generation: number, groups: number, frame: number) {
      integers[8] = generation;
      integers[9] = groups;
      integers[10] = frame;
      // Mot par mot : cette écriture a lieu à chaque image encodée, et n'alloue donc rien.
      cascades.levels.forEach((level, index) => {
        const at = HEADER_WORDS + index * LEVEL_WORDS;
        floats[at + 3] = level.spacing;
        for (let axis = 0; axis < 3; axis++) {
          // `originSpacing.xyz` : le centre monde de la maille de base. `base.xyz` : cette maille.
          floats[at + axis] = (level.base[axis] + 0.5) * level.spacing;
          floats[at + 4 + axis] = level.base[axis];
        }
      });
      upload();
    },
    dispose() {
      buffer.destroy();
    },
  };
}
