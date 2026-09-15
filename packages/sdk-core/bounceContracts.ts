/**
 * La lumière qui rebondit : réglages publiés et contrat du proxy résident.
 *
 * Rien ici ne nomme une scène. Le proxy est une représentation grossière de toute la géométrie,
 * construite à la compilation et indépendante de la caméra (LC1) ; les sondes lancent leurs rayons
 * contre lui, jamais contre la coupe visible, et l'irradiance qu'elles accumulent s'applique à la
 * résolution différée opaque multipliée par l'albédo (LR4).
 *
 * Aucune lumière n'apparaît sans source déclarée (P6) : sans lampe, l'irradiance indirecte est
 * exactement nulle, parce que rien n'a éclairé le point que le rayon a touché.
 */

/** Réglages du rebond. Ce sont des choix de produit nommés : chaque borne du runtime les relit. */
export const BOUNCE_SETTINGS = {
  /**
   * Plancher de l'erreur géométrique certifiée d'un cluster retenu dans le proxy, en mètres (LC1).
   * Le seuil réellement obtenu double tant que la coupe ne tient pas dans le budget de triangles ;
   * le manifeste publie celui qu'elle a pris.
   */
  proxyErrorMetres: 0.05,
  /** Triangles du proxy d'une scène entière, toutes instances posées : ce qui reste résident. */
  proxyTriangleBudget: 300_000,
  /** Triangles d'une feuille du BVH : la boucle d'une feuille est bornée par ce nombre (X2). */
  proxyLeafTriangles: 8,
  /** Nœuds visités par rayon : la traversée est bornée avant l'image, jamais par la profondeur. */
  traversalSteps: 512,
  /** Sondes de la grille, au plus. Au-delà, la grille s'écarte au lieu de s'agrandir. */
  maxProbes: 16384,
  /** Sondes sur un axe, au plus : une grille très plate reste lisible dans les deux autres. */
  maxProbesPerAxis: 64,
  /** Écartement visé entre deux sondes, en mètres. Une emprise plus grande écarte les sondes. */
  probeSpacingMetres: 2,
  /** Rayons lancés par sonde à chaque mise à jour. Budget fixe et réglable (X2). */
  raysPerProbe: 32,
  /**
   * Sondes mises à jour par image : la grille est balayée en `probes / probesPerFrame` images.
   * C'est le budget de rayons de l'image, et il ne bouge pas : c'est la lumière qui converge, pas
   * la cadence qui cède. Une petite scène balaie tout d'un coup, une grande y met le temps qu'il
   * faut, et le harnais publie ce temps.
   */
  probesPerFrame: 8192,
  /** Lampes testées au point touché : la boucle du rayon est bornée par ce nombre (X2). */
  lightsPerRay: 4,
  /**
   * Amortissement plancher d'une sonde stable : une moyenne courante finit par s'y arrêter, et
   * c'est ce plancher qui fixe le nombre de rayons dont l'image finale garde la mémoire.
   */
  blendStable: 0.04,
  /** Amortissement d'une sonde qui saute : elle reprend presque tout, donc le retard reste court. */
  blendMoving: 0.8,
  /** Résidu relatif au-delà duquel une sonde est déclarée en mouvement (hystérésis adaptative). */
  movingResidual: 0.12,
  /**
   * Balayages complets sans changement après lesquels la passe n'est plus encodée du tout. Chaque
   * balayage ajoute un ordre de rebond à la série : il en faut assez pour que la série soit close,
   * sans quoi l'état « stable » dépendrait de l'histoire de la scène et non d'elle seule.
   */
  settledSweeps: 12,
  /**
   * Distance moyenne en deçà de laquelle une sonde se déclare enterrée dans une surface, en
   * fraction du plus petit pas de la grille. Une sonde enterrée ne pèse plus rien : sans cela, la
   * lumière de l'intérieur d'un mur se répandrait dans la pièce d'à côté.
   */
  buriedFraction: 0.15,
  /** Marge de visibilité d'une sonde, en fraction de l'écartement : au-delà elle est derrière un mur. */
  visibilityMargin: 0.6,
  /** Décalage du point d'application le long de la normale, en fraction de l'écartement. */
  normalBias: 0.35,
  /** Portée d'un rayon de sonde, en fraction de la diagonale de l'emprise : au-delà, rien à toucher. */
  rayReachFraction: 1,
} as const;

/** Flottants d'une sonde dans le tampon GPU : six `vec4f`, jamais réalloués. */
export const PROBE_FLOATS = 24;

/** Version du produit de cache « proxy ». Un proxy d'une autre version est refusé, jamais deviné. */
export const SCENE_PROXY_VERSION = 1;
/** 'W','G','P','X' lus comme un entier non signé de 32 bits en petit-boutiste. */
export const SCENE_PROXY_MAGIC = 0x58504757;
/** Entiers d'en-tête : signature, version, triangles, nœuds. */
export const SCENE_PROXY_HEADER_WORDS = 4;
/** Nombres par triangle du proxy : trois sommets monde, sans normale — elle se déduit du triangle. */
export const PROXY_TRIANGLE_FLOATS = 9;
/** Nombres par nœud du BVH : bornes basses puis hautes. */
export const PROXY_NODE_FLOATS = 6;
/** Entiers par nœud : saut de sous-arbre, premier triangle, nombre de triangles (0 = nœud interne). */
export const PROXY_NODE_WORDS = 3;

/** Les colonnes du proxy, telles que son objet de cache les porte et que le GPU les recopie. */
export interface SceneProxyColumns {
  /** Trois sommets monde par triangle, `PROXY_TRIANGLE_FLOATS` nombres chacun. */
  triangles: Float32Array;
  /** Albédo diffus linéaire du triangle, empaqueté RGBA8. */
  albedo: Uint32Array;
  /** Bornes de chaque nœud du BVH. */
  nodeBounds: Float32Array;
  /** Saut, premier triangle et nombre de triangles de chaque nœud. */
  nodeLinks: Uint32Array;
}

/**
 * Ce que le manifeste dit du proxy résident : où le lire, ce qu'il pèse et ce qu'il vaut. C'est un
 * produit de cache à part, et non une colonne du sidecar : un manifeste sans lui reste lisible mot
 * pour mot par un moteur qui l'ignore, et ses dizaines de mégaoctets ne retardent pas la première
 * image d'une scène qui ne déclare aucune lampe.
 */
export interface SceneProxyDescriptor {
  version: number;
  url: string;
  sha256: string;
  bytes: number;
  /** Le plus grand seuil d'erreur géométrique qu'une primitive a dû prendre, en mètres. */
  errorMetres: number;
  /** Plancher du seuil : ce que la spécification demande avant que le budget ne l'élargisse. */
  errorFloorMetres: number;
  /** Budget de triangles publié, celui qui a décidé du seuil réellement obtenu. */
  triangleBudget: number;
  /** Emprise monde du proxy : trois bornes basses puis trois hautes. */
  bounds: [number, number, number, number, number, number];
  triangles: number;
  nodes: number;
}

/** Le proxy lu : son descriptif et ses colonnes, vues sur les octets de son objet de cache. */
export interface SceneProxy extends SceneProxyDescriptor {
  data: SceneProxyColumns;
}

/**
 * La grille de sondes d'une emprise.
 *
 * Les sondes sont au centre des mailles, jamais à leurs coins : une sonde posée sur l'emprise
 * tombe dans le mur, le sol ou le plafond qui la borne, n'y voit rien et ne sait plus rien dire de
 * la pièce. L'écartement visé fixe le nombre de mailles, le budget le plafonne, et l'écartement
 * réellement obtenu est publié. Rien ici ne connaît de scène : une emprise et deux bornes suffisent.
 */
export function probeGridOf(bounds: readonly number[]) {
  const extent = [
    Math.max(bounds[3] - bounds[0], 0),
    Math.max(bounds[4] - bounds[1], 0),
    Math.max(bounds[5] - bounds[2], 0),
  ];
  let counts = extent.map((size) =>
    Math.min(
      BOUNCE_SETTINGS.maxProbesPerAxis,
      Math.max(1, Math.round(size / BOUNCE_SETTINGS.probeSpacingMetres)),
    ),
  );
  // Le budget se tient en écartant les sondes, jamais en tronquant l'emprise : une pièce entière
  // reste couverte, plus grossièrement, plutôt que couverte à moitié.
  while (counts[0] * counts[1] * counts[2] > BOUNCE_SETTINGS.maxProbes) {
    const axis = counts.indexOf(Math.max(...counts));
    if (counts[axis] <= 1) break;
    counts = counts.map((value, index) => (index === axis ? value - 1 : value));
  }
  const spacing = extent.map((size, axis) => Math.max(size / counts[axis], 1e-3));
  return {
    counts: counts as [number, number, number],
    origin: [
      bounds[0] + spacing[0] / 2,
      bounds[1] + spacing[1] / 2,
      bounds[2] + spacing[2] / 2,
    ] as [number, number, number],
    spacing: spacing as [number, number, number],
    probes: counts[0] * counts[1] * counts[2],
  };
}
