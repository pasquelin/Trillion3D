import type { SdkWasm } from './geometryPageWasm.ts';

/**
 * Le tampon partagé : des blocs réservés dans la mémoire linéaire du module WebAssembly du SDK, sur
 * lesquels JavaScript pose ses vues typées. Les deux côtés lisent et écrivent les mêmes octets ;
 * rien n'est recopié sur le chemin de calcul.
 *
 * LA CROISSANCE, À UN SEUL ENDROIT. `WebAssembly.Memory.grow` remplace le `ArrayBuffer` et détache
 * toutes les vues déjà construites : une vue caduque lit zéro sans rien signaler. Ici, la seule
 * fonction qui peut faire grandir la mémoire est `reserveArena`, qui alloue une fois pour tout le
 * lot puis construit TOUTES les vues après. Tant qu'un tampon est vivant, les appels de calcul
 * n'allouent rien — les noyaux écrivent dans les blocs qu'on leur désigne — donc aucune vue ne
 * devient caduque en cours d'image. Réserver par lot, jamais par image.
 *
 * Un bloc porte son propre type : `Float64Array` pour les matrices, les boîtes, les sphères et les
 * erreurs, `Float32Array` pour ce qui arrive déjà en simple précision, `Uint32Array` pour les
 * drapeaux, les identifiants et les compteurs. Une sortie de taille variable se déclare en deux
 * blocs — un compteur d'un mot, une liste à sa taille maximale — et se relit avec `liste()`.
 */

/** Version du contrat du tampon et des lots. Un module qui rend autre chose est refusé. */
export const WASM_ARENA_CONTRACT = 1;

/** Alignement de chaque bloc, en octets : celui d'un `f64`, qui couvre aussi 32 bits. */
const ALIGNEMENT = 8;

export type ArenaType = 'f64' | 'f32' | 'u32';
export type ArenaView = Float64Array | Float32Array | Uint32Array;

const TAILLES: Record<ArenaType, number> = { f64: 8, f32: 4, u32: 4 };
const CONSTRUCTEURS = {
  f64: Float64Array,
  f32: Float32Array,
  u32: Uint32Array,
} as const;

export interface ArenaDemande {
  readonly type: ArenaType;
  /** Nombre d'éléments du bloc. Pour une sortie de taille variable, son maximum. */
  readonly longueur: number;
  /** Pas des sous-vues, en éléments ; absent quand le bloc n'en a pas besoin. */
  readonly pas?: number;
}

export interface ArenaBloc {
  readonly type: ArenaType;
  /** Offset en OCTETS dans la mémoire linéaire : ce que les fonctions du module attendent. */
  readonly offset: number;
  readonly vue: ArenaView;
  /** Sous-vues de `pas` éléments, ou `null` quand la demande n'en réclamait pas. */
  readonly vues: readonly ArenaView[] | null;
}

export interface Arena {
  readonly blocs: readonly ArenaBloc[];
  readonly octets: number;
  /** Les `n` premiers éléments d'un bloc : la partie utile d'une sortie à taille variable. */
  liste(index: number, n: number): ArenaView;
  libere(): void;
}

const aligne = (octets: number) => Math.ceil(octets / ALIGNEMENT) * ALIGNEMENT;

/** Un bloc et ses sous-vues, quelle que soit la mémoire qui le porte. */
function bloc(demande: ArenaDemande, offset: number, vue: ArenaView): ArenaBloc {
  const pas = demande.pas ?? 0;
  let vues: ArenaView[] | null = null;
  if (pas > 0) {
    const compte = Math.floor(demande.longueur / pas);
    vues = new Array(compte);
    for (let i = 0; i < compte; i++) vues[i] = vue.subarray(i * pas, i * pas + pas);
  }
  return { type: demande.type, offset, vue, vues };
}

/**
 * Les mêmes blocs hors de la mémoire du module : ce sur quoi le chemin JavaScript travaille quand
 * WebAssembly manque. Leur `offset` vaut zéro — il ne désigne aucune mémoire linéaire.
 */
export function blocsJavaScript(demandes: readonly ArenaDemande[]): ArenaBloc[] {
  return demandes.map((demande) =>
    bloc(demande, 0, new CONSTRUCTEURS[demande.type](demande.longueur)),
  );
}

/**
 * Réserve les blocs demandés en une seule allocation et rend leurs vues. `null` quand le module
 * refuse la taille : l'appelant reste alors sur le chemin JavaScript, avec ses propres tableaux.
 */
export function reserveArena(wasm: SdkWasm, demandes: readonly ArenaDemande[]): Arena | null {
  const plan: { demande: ArenaDemande; debut: number }[] = [];
  let octets = 0;
  for (const demande of demandes) {
    plan.push({ demande, debut: octets });
    octets += aligne(demande.longueur * TAILLES[demande.type]);
  }
  const base = wasm.arena_alloc(octets);
  if (!base) return null;
  // Après cette allocation, et seulement après, la mémoire linéaire est à sa taille définitive pour
  // la durée du tampon : toutes les vues se construisent ici.
  const memoire = wasm.memory.buffer;
  const blocs: ArenaBloc[] = plan.map(({ demande, debut }) =>
    bloc(
      demande,
      base + debut,
      new CONSTRUCTEURS[demande.type](memoire, base + debut, demande.longueur),
    ),
  );
  let rendu = false;
  return {
    blocs,
    octets,
    liste: (index, n) => blocs[index].vue.subarray(0, n),
    libere: () => {
      if (rendu) return;
      rendu = true;
      wasm.arena_free(base, octets);
    },
  };
}
