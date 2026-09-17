import type { PageRec } from './pageSelection.ts';

const levelOf = (page: PageRec) => page.level ?? 0;

/**
 * Ranks the cut the page budget has to cut down: coarsest level first, and within a level the order
 * the pages joined the weighed set.
 *
 * What is weighed is **pages**, not placements. The budget it is compared against is a number of
 * cache slots, and a slot holds a page: two placements of one page — the same cluster under two
 * instances of an object — occupy one slot and must count once. Counting placements made the budget
 * refuse cuts that fit ten times over, and the queue it then wrote was a prefix whose page count
 * depended on how the placements happened to be distributed, so the resident set depended on the
 * order the network had filled it in.
 *
 * Le classement ne parcourt plus la coupe. Les clés pesées sont rangées PAR NIVEAU au moment où elles
 * entrent et sortent — la seule chose qui les fasse bouger —, si bien que le préfixe s'écrit en
 * lisant les niveaux les plus grossiers d'abord et en s'arrêtant au budget : son coût est celui du
 * budget, jamais celui de la coupe. Ce que le préfixe contient est inchangé en nature — une
 * couverture complète plus autant de détail que le budget en porte, jamais une coupe tronquée de la
 * surface —, et son ordre interne est désormais stable d'une image à l'autre, là où l'ordre de
 * publication du relevé, tiré d'un compteur atomique, le remettait en cause à chaque image et
 * faisait réécrire la file pour rien.
 *
 * Nothing is allocated once the budget and the levels of a scene are known.
 */
export function createBudgetRanking(options: {
  keyCount: number;
  bootstrapKey: Uint8Array;
  keyOf: (page: PageRec) => number;
}) {
  const { keyCount, bootstrapKey, keyOf } = options;
  /** Non-cover pages of the opaque cut, per level: leur nombre, et la liste de leurs clés. */
  let held = new Int32Array(8);
  const lists: Int32Array[] = [];
  /** Placements holding each key, and where the key sits: a key counts once however many hold it. */
  const refs = new Int32Array(Math.max(1, keyCount));
  const slotOf = new Int32Array(Math.max(1, keyCount));
  /** Le premier placement qui a nommé la clé : l'enregistrement par lequel elle sera cherchée. */
  const pageOfKey: (PageRec | undefined)[] = new Array(Math.max(1, keyCount));
  /** The ranked prefix, one entry per page, and the keys beside it. Sized to the budget once. */
  const ranked: PageRec[] = [];
  let keys = new Int32Array(0);
  let length = 0,
    weighed = 0;
  const grow = (level: number) => {
    if (level >= held.length) {
      const size = 1 << (32 - Math.clz32(level));
      const next = new Int32Array(size);
      next.set(held);
      held = next;
    }
    const list = lists[level];
    if (list && held[level] < list.length) return list;
    const size = Math.max(8, (list?.length ?? 0) * 2);
    const next = new Int32Array(size);
    if (list) next.set(list);
    return (lists[level] = next);
  };
  return {
    ranked,
    get keys() {
      return keys;
    },
    get length() {
      return length;
    },
    /** Pages of the opaque cut the budget weighs, the pinned cover excluded. */
    get pageCount() {
      return weighed;
    },
    /** One placement of the opaque cut joins the weighed set; the cover is never weighed. */
    add(page: PageRec) {
      const key = keyOf(page);
      if (bootstrapKey[key] || refs[key]++ > 0) return;
      const level = levelOf(page),
        list = grow(level);
      slotOf[key] = held[level];
      list[held[level]++] = key;
      pageOfKey[key] = page;
      weighed++;
    },
    /** One placement leaves it; the page leaves only with its last placement. */
    remove(page: PageRec) {
      const key = keyOf(page);
      if (bootstrapKey[key] || refs[key] <= 0 || --refs[key] > 0) return;
      // Le niveau appartient à la page, pas au placement : celui qui sort est celui qui est entré.
      const level = levelOf(page),
        list = lists[level];
      // La dernière clé du niveau prend la place libérée : la liste reste dense, sans être triée.
      const last = list[--held[level]];
      list[slotOf[key]] = last;
      slotOf[last] = slotOf[key];
      pageOfKey[key] = undefined;
      weighed--;
    },
    /** True when the queue already holds exactly the ranked prefix, in the same order. */
    matches(list: Int32Array, count: number, pages: readonly PageRec[]) {
      if (count !== length) return false;
      for (let i = 0; i < length; i++)
        if (list[i] !== keys[i] || pages[i] !== ranked[i]) return false;
      return true;
    },
    /**
     * Counts the pages the budget weighs and, when that overruns `room`, writes the prefix it keeps
     * into `ranked`/`keys`. Returns the page count so the caller can tell a cut that fits from one
     * that does not without counting it twice.
     */
    rank(room: number) {
      const records = weighed;
      if (records <= room) return records;
      if (keys.length < room) {
        keys = new Int32Array(room);
        ranked.length = room;
      }
      // The coarsest levels are kept whole until one of them straddles the budget; that one gives its
      // first `atCut` pages and the finer levels give none.
      let taken = 0,
        floor = 0,
        atCut = 0;
      for (let level = held.length - 1; level >= 0; level--) {
        if (taken + held[level] >= room) {
          floor = level;
          atCut = room - taken;
          break;
        }
        taken += held[level];
      }
      // Deux boucles et pas une fermeture : celle-ci était allouée à chaque classement et sortait
      // son curseur des registres, sur autant d'itérations que le budget porte de pages.
      let at = 0;
      for (let level = held.length - 1; level >= floor; level--) {
        const list = lists[level],
          take = level > floor ? held[level] : atCut;
        for (let i = 0; i < take; i++) {
          const key = list[i];
          keys[at] = key;
          ranked[at++] = pageOfKey[key] as PageRec;
        }
      }
      length = at;
      return records;
    },
  };
}
