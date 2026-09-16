import type { SdkWasm } from './geometryPageWasm.ts';

/**
 * Le tampon partagé : des blocs réservés dans la mémoire linéaire du module WebAssembly du SDK, sur
 * lesquels JavaScript pose ses vues typées. Les deux côtés lisent et écrivent les mêmes octets ;
 * rien n'est recopié sur le chemin de calcul.
 *
 * LA CROISSANCE, TENUE PAR UNE GÉNÉRATION. `WebAssembly.Memory.grow` remplace le `ArrayBuffer` et
 * détache toutes les vues déjà construites : une vue caduque lit zéro sans rien signaler. N'importe
 * quelle allocation du module peut la provoquer — un décodage de page replié sur le fil principal
 * autant qu'une seconde réservation —, donc l'interdire ailleurs ne suffisait pas. Ici, `blocs()`
 * compare le tampon courant du module à celui qui portait les vues et les RECONSTRUIT toutes quand
 * il a changé, en comptant une génération de plus. Les octets, eux, survivent : `grow` recopie la
 * mémoire, et un bloc garde donc son offset et son contenu. Rien n'est jamais recopié par nous.
 *
 * Un appelant ne garde donc pas une vue d'une image à l'autre : il la redemande par `blocs()`, qui
 * ne coûte qu'une comparaison de tampon tant que la mémoire n'a pas bougé. Les offsets, eux, sont
 * stables pour toute la vie du tampon — ce sont eux que les fonctions du module reçoivent.
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

type ArenaType = 'f64' | 'f32' | 'u32';
type ArenaView = Float64Array | Float32Array | Uint32Array;

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
  /**
   * Les blocs du tampon, leurs vues reconstruites si la mémoire du module a grandi depuis le dernier
   * appel. Vide une fois le tampon rendu : plus aucune vue ne désigne une mémoire à nous.
   */
  blocs(): readonly ArenaBloc[];
  /** Reconstructions subies depuis la réservation. Zéro dit que la mémoire n'a jamais bougé. */
  generation(): number;
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
  const construit = () =>
    plan.map(({ demande, debut }) =>
      bloc(
        demande,
        base + debut,
        new CONSTRUCTEURS[demande.type](wasm.memory.buffer, base + debut, demande.longueur),
      ),
    );
  let blocs = construit();
  let porteur = wasm.memory.buffer;
  let generation = 0;
  let rendu = false;
  /** Les blocs à jour : une comparaison de tampon, et une reconstruction seulement s'il a changé. */
  const actuels = () => {
    if (!rendu && wasm.memory.buffer !== porteur) {
      porteur = wasm.memory.buffer;
      generation++;
      blocs = construit();
    }
    return blocs;
  };
  return {
    blocs: actuels,
    generation: () => generation,
    octets,
    liste: (index, n) => actuels()[index].vue.subarray(0, n),
    libere: () => {
      if (rendu) return;
      rendu = true;
      blocs = [];
      wasm.arena_free(base, octets);
    },
  };
}
