import { BOUNCE_SETTINGS } from './bounceContracts.ts';

/**
 * Les cascades de sondes : des cubes de sondes emboîtés, du plus serré autour de la caméra au plus
 * large sur la scène entière.
 *
 * Une grille unique posée sur l'emprise d'une ville passe l'essentiel de ses sondes sur du ciel et
 * n'en met aucune là où l'image en a besoin. Les cascades renversent cela : chaque niveau porte le
 * même nombre de sondes, et son écartement double d'un niveau au suivant, si bien que la densité
 * décroît avec la distance à la caméra exactement comme l'image en a besoin. Le dernier niveau ne
 * suit pas la caméra : il est fixe dans le monde et couvre l'emprise entière du proxy, pour que
 * rien de la scène ne se retrouve hors de portée d'une sonde.
 *
 * Deux propriétés portent tout le reste. Les sondes d'un niveau vivent sur un **réseau global**,
 * aux points `(maille + ½) · écartement` : une sonde ne bouge donc jamais, et déplacer la caméra ne
 * fait qu'entrer et sortir des mailles. Et une maille se range dans le tampon par son reste modulo
 * le côté du cube : quand la cascade glisse d'une maille, seules les sondes de la tranche qui entre
 * changent de maille, toutes les autres gardent la leur et le travail déjà fait avec.
 *
 * Rien ici ne nomme une scène : une emprise, un point de vue, deux bornes publiées.
 */
export interface BounceCascadeLevel {
  /** Écartement de ce niveau, en mètres. */
  spacing: number;
  /** Maille du monde que porte la sonde d'indice zéro du niveau, sur chaque axe. */
  base: [number, number, number];
  /** Faux pour le dernier niveau, qui reste fixe dans le monde. */
  moving: boolean;
}

export interface BounceCascades {
  /** Sondes sur un axe et par niveau. */
  size: number;
  probesPerLevel: number;
  probes: number;
  levels: BounceCascadeLevel[];
  /** Portée d'un rayon : la diagonale de l'emprise, au-delà de laquelle il n'y a rien à toucher. */
  reach: number;
  /** Sondes du lot de l'image, par niveau : les parts publiées, appliquées à un lot total. */
  shareOf(total: number): number[];
  /**
   * Repose les niveaux mobiles autour d'un point de vue. Rend vrai quand au moins une maille de
   * base a changé : c'est le seul signal dont la convergence a besoin pour repartir, et il ne
   * coûte aucune lecture de la carte graphique.
   */
  follow(viewpoint: ArrayLike<number>): boolean;
}

/**
 * L'écartement de chaque niveau : le plus fin doublé à chaque cran.
 *
 * La cascade s'arrête au premier niveau qui couvre déjà l'emprise entière — au-delà, un niveau de
 * plus ne verrait rien que le précédent ne voie, et il coûterait un balayage. Une petite scène n'a
 * donc qu'un seul niveau, fixe, et une ville en a quatre. Le dernier niveau, quel que soit son rang,
 * s'élargit jusqu'à couvrir l'emprise : rien de la scène ne reste hors de portée d'une sonde.
 */
function spacingsOf(bounds: readonly number[]): number[] {
  const { cascadeLevels, cascadeSize, cascadeSpacingMetres, cascadeLayersAcross } = BOUNCE_SETTINGS;
  const sizes = [0, 1, 2].map((axis) => Math.max(bounds[3 + axis] - bounds[axis], 1e-3));
  const extent = Math.max(...sizes);
  // Le niveau le plus fin ne dépasse jamais son plafond et se resserre jusqu'à garder assez de
  // couches en travers de la plus mince dimension de la scène.
  // Un cube de `cascadeSize` sondes ne couvre que `cascadeSize - 3` mailles utiles : une maille de
  // couronne de chaque côté, et une de plus parce qu'une sonde est au centre de sa maille.
  const useful = cascadeSize - 3;
  // L'écartement du plus fin est aussi celui qui, doublé à chaque cran, laisse le dernier niveau
  // couvrir l'emprise : tous les écartements sont alors des puissances de deux du plus fin, et la
  // carte d'occupation d'un niveau est la réduction exacte de celle du niveau précédent.
  const finest = Math.max(
    Math.min(cascadeSpacingMetres, Math.min(...sizes) / cascadeLayersAcross),
    extent / (useful * 2 ** (cascadeLevels - 1)),
  );
  const spacings: number[] = [];
  for (let level = 0; level < cascadeLevels; level++) {
    spacings.push(finest * 2 ** level);
    if (spacings[level] * useful >= extent) break;
  }
  return spacings;
}

/** La maille de base d'un niveau : centrée sur le point de vue s'il suit, sur l'emprise sinon. */
function baseOf(
  spacing: number,
  moving: boolean,
  viewpoint: ArrayLike<number>,
  bounds: readonly number[],
): [number, number, number] {
  const half = BOUNCE_SETTINGS.cascadeSize / 2;
  // Le niveau fixe pose sa base une maille avant l'emprise : sans cette couronne, un point du sol
  // décalé le long de sa normale tomberait hors du niveau et son rebond vaudrait exactement zéro.
  return [0, 1, 2].map((axis) =>
    moving ? Math.floor(viewpoint[axis] / spacing) - half : Math.floor(bounds[axis] / spacing) - 1,
  ) as [number, number, number];
}

export function createBounceCascades(bounds: readonly number[]): BounceCascades {
  const size = BOUNCE_SETTINGS.cascadeSize;
  const probesPerLevel = size * size * size;
  const spacings = spacingsOf(bounds);
  const levels: BounceCascadeLevel[] = spacings.map((spacing, level) => ({
    spacing,
    base: baseOf(spacing, false, bounds, bounds),
    moving: level < spacings.length - 1,
  }));
  const shares = BOUNCE_SETTINGS.cascadeShares.slice(0, levels.length);
  const weight = shares.reduce((sum, share) => sum + share, 0) || 1;
  return {
    size,
    probesPerLevel,
    probes: probesPerLevel * levels.length,
    levels,
    reach:
      Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) *
      BOUNCE_SETTINGS.rayReachFraction,
    shareOf(total) {
      // Au moins une sonde par niveau : un niveau à qui l'arrondi ne laisse rien ne convergerait
      // jamais, et c'est le dernier — celui qui porte le fond de la scène — qui serait perdu.
      return shares.map((share) => Math.max(1, Math.round((total * share) / weight)));
    },
    follow(viewpoint) {
      let moved = false;
      for (const level of levels) {
        if (!level.moving) continue;
        const base = baseOf(level.spacing, true, viewpoint, bounds);
        if (base.some((value, axis) => value !== level.base[axis])) moved = true;
        level.base = base;
      }
      return moved;
    },
  };
}
