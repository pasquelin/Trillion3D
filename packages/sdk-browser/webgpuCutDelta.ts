import { catalogueIndexOf, type PageRec } from './pageSelection.ts';

/**
 * La différence publiée, et ce qu'on peut lui demander.
 *
 * Les comptes sont des CHAMPS, pas des accesseurs : leurs lecteurs les parcourent vingt mille fois
 * par image, un accesseur ne s'y inline pas, et chacun devait hisser la borne à la main — trois fois
 * le même geste et trois fois le même commentaire — pour retrouver le prix d'un champ. Le contrat le
 * donne maintenant une fois pour toutes. Les tampons sont réécrits sur place, jamais réalloués, et
 * ce que le lecteur en voit est valide jusqu'à la coupe suivante.
 */
export type CutDelta = {
  /** Les identifiants entrés et sortis depuis la coupe précédente, et leur nombre. */
  readonly entered: Int32Array;
  readonly exited: Int32Array;
  readonly enteredCount: number;
  readonly exitedCount: number;
  /** Les identifiants que la coupe retient. */
  readonly count: number;
  /**
   * Faux quand le relevé appliqué porte exactement la même suite d'identifiants que le précédent,
   * dans le même ordre : `pages` a été réécrit avec les mêmes enregistrements, aux mêmes rangs.
   * Ce n'est pas l'égalité des ensembles — un ordre différent, même à ensemble égal, est un
   * changement — et c'est ce qu'il faut à qui lit `pages` dans l'ordre.
   */
  readonly changed: boolean;
  /** Vrai quand l'identifiant appartient au relevé tenu. */
  has(id: number): boolean;
  /** Reports no difference: the cut is the one already held, records included. */
  hold(): void;
  /** Difference between `ids` and the cut held, and `pages` rewritten in the order of `ids`. */
  apply(ids: readonly number[]): void;
  /**
   * La même différence, publiée par une coupe qui nomme ses enregistrements au lieu de leurs rangs
   * — la coupe processeur. Le catalogue a le dernier mot, comme partout. Rien n'est alloué passé la
   * première coupe.
   */
  adoptRecords(records: readonly PageRec[]): void;
};

/**
 * The opaque cut as a set that outlives the image: given the page ids the GPU published, it names the
 * pages that entered and left since the previous cut, so every consumer downstream reads a difference
 * instead of a list.
 *
 * `pages` — the record array the caller owns — is written in the order the cut published, which is
 * the order the host streams in, et cette différence en est le seul écrivain. Un appelant qui ne
 * veut que la différence l'omet : aucune liste d'enregistrements n'est alors bâtie, et le relevé ne
 * coûte plus que sa propre longueur.
 *
 * Rien n'est alloué une fois la scène connue, et rien n'est appelé par page : l'appartenance est une
 * marque d'époque lue à même un tableau typé — l'époque du relevé pour le dédoublonnage, celle du
 * relevé précédent pour l'entrée —, les sorties se lisent sur la liste des retenues d'avant, et une
 * image qui adopte le relevé qu'elle tient déjà n'écrit rien du tout.
 *
 * La coupe de la carte y arrive par ses identifiants (`apply`), celle du processeur par ses
 * enregistrements (`adoptRecords`) : un seul contrat, et les lecteurs ne savent pas laquelle décide.
 */
export function createCutDelta(packedPages: readonly PageRec[], pages?: PageRec[]): CutDelta {
  const capacity = Math.max(1, packedPages.length);
  /** L'époque du relevé où l'identifiant a été retenu pour la dernière fois. */
  const mark = new Int32Array(capacity).fill(-1);
  const entered = new Int32Array(capacity),
    exited = new Int32Array(capacity);
  /** Les identifiants retenus par le relevé précédent et par celui en cours : deux tampons échangés,
   *  jamais réalloués, parce que les sorties se lisent sur l'ancien pendant que le neuf s'écrit. */
  let kept = new Int32Array(capacity),
    keptNext = new Int32Array(capacity);
  /** La suite d'identifiants que le dernier relevé a publiée, pour la comparer telle quelle. */
  const published = new Int32Array(capacity);
  let epoch = 0,
    keptCount = 0,
    publishedCount = -1;
  /**
   * Vrai quand `ids` est exactement la suite que le dernier relevé appliqué a publiée. Une passe
   * d'entiers, sans une seule écriture : c'est elle qui autorise à ne rien refaire du tout — ni les
   * marques, ni les retenues, ni les enregistrements — quand un relevé neuf republie la même coupe.
   */
  const samePublished = (ids: readonly number[]) => {
    if (ids.length !== publishedCount || ids.length > capacity) return false;
    for (let i = 0; i < ids.length; i++) if (published[i] !== ids[i]) return false;
    return true;
  };
  /** Le relevé tenu : aucune différence n'est publiée, et la liste est déjà celle qu'il décrit. */
  const hold = () => {
    state.changed = false;
    state.enteredCount = 0;
    state.exitedCount = 0;
  };
  /** Les rangs de page d'une liste d'enregistrements. Vidé puis rempli par empilement, jamais
   *  agrandi par sa longueur : un tableau agrandi ainsi reste troué à vie, et la boucle la plus
   *  chaude du moteur le paie. Mesuré : 1,611 ms contre 1,737 ms pour un tampon typé équivalent. */
  const recordIds: number[] = [];
  const apply = (ids: readonly number[]) => {
    // Un relevé neuf qui republie la même suite décrit la coupe déjà tenue : elle est tenue, et
    // pas une des quinze mille fiches n'est réécrite.
    if (samePublished(ids)) return hold();
    const previous = epoch;
    epoch++;
    let enteredCount = 0,
      exitedCount = 0;
    // Une suite plus longue que le catalogue ne se garde pas : elle est déclarée changée.
    let same = ids.length === publishedCount && ids.length <= capacity;
    publishedCount = ids.length <= capacity ? ids.length : -1;
    let keptNow = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (i < capacity && published[i] !== id) {
        published[i] = id;
        same = false;
      }
      if (id < 0 || id >= capacity) continue;
      const seen = mark[id];
      if (seen === epoch) continue;
      const rec = packedPages[id];
      if (!rec) continue;
      mark[id] = epoch;
      if (pages) pages[keptNow] = rec;
      keptNext[keptNow++] = id;
      if (seen !== previous) entered[enteredCount++] = id;
    }
    if (pages) pages.length = keptNow;
    for (let i = 0; i < keptCount; i++) {
      const id = kept[i];
      if (mark[id] !== epoch) exited[exitedCount++] = id;
    }
    const swap = kept;
    kept = keptNext;
    keptNext = swap;
    keptCount = keptNow;
    state.enteredCount = enteredCount;
    state.exitedCount = exitedCount;
    state.count = keptNow;
    state.changed = !same;
  };
  const state = {
    entered,
    exited,
    enteredCount: 0,
    exitedCount: 0,
    count: 0,
    changed: true,
    has: (id: number) => id >= 0 && id < capacity && mark[id] === epoch,
    hold,
    apply,
    adoptRecords(records: readonly PageRec[]) {
      recordIds.length = 0;
      for (let i = 0; i < records.length; i++) {
        const id = catalogueIndexOf(packedPages, records[i]);
        if (id !== undefined) recordIds.push(id);
      }
      apply(recordIds);
    },
  };
  return state;
}
