import { sortPages } from '../sdk-core/index.ts';

/**
 * Les pages qui réclament l'écriture d'une fiche de ligne et ne l'ont pas encore reçue.
 *
 * Écrire une fiche coûte un matériau, un hachage, des modes d'adressage, une sphère d'ombre, huit
 * coins et cinq mots de fiche : une rafale d'arrivées en paie autant de fois, sur le fil principal,
 * dans la même image. Cette liste est ce qui reste à faire, et l'allocateur de rangs n'en consomme
 * qu'un budget de temps par image — le reste attend l'image suivante, dans le même ordre.
 *
 * Une page ne s'y inscrit qu'une fois : le marquage par page est ce qui le garantit, et une page
 * réclamée deux fois avant d'être servie ne double donc pas le travail. La liste est triée avant
 * d'être servie, parce que le journal des résidences n'écrit des plages que tant que les index
 * qu'on lui donne montent.
 */
export function createWebgpuRowClaims(pageCount: number) {
  const marks = new Uint8Array(Math.max(1, pageCount));
  const pages = new Int32Array(Math.max(1, pageCount));
  let count = 0;
  return {
    pages,
    get count() {
      return count;
    },
    /** Inscrit une page, sauf si elle attend déjà son tour. */
    add(page: number) {
      if (marks[page]) return;
      marks[page] = 1;
      pages[count++] = page;
    },
    /** Range la liste par index de page croissant, l'ordre que le journal des résidences exige. */
    sort() {
      sortPages(pages, count);
    },
    /** Retire les `served` premières pages, déjà servies, et garde la suite dans son ordre. */
    consume(served: number) {
      for (let i = 0; i < served; i++) marks[pages[i]] = 0;
      if (served < count) pages.copyWithin(0, served, count);
      count -= served;
    },
    /** Plus rien n'attend : la table vient d'être refaite d'un bloc. */
    clear() {
      for (let i = 0; i < count; i++) marks[pages[i]] = 0;
      count = 0;
    },
  };
}

export type WebgpuRowClaims = ReturnType<typeof createWebgpuRowClaims>;

/**
 * Temps qu'une image accorde à l'écriture des fiches. Même plafond, même règle que le drain des
 * arrivées : l'horloge est relue après chaque fiche et le reste attend l'image suivante, dans le
 * même ordre. Une fiche au moins passe toujours, sans quoi une page ne serait jamais écrite.
 */
const CLAIM_BUDGET_MS = 2;

/**
 * Sert la file dans l'ordre croissant des pages jusqu'au budget de temps. `release` redit si la
 * page réclame encore une fiche — elle a pu repartir depuis son inscription, et quitte alors la
 * file sans rien coûter —, `place` l'écrit et rend `false` quand la table est pleine.
 *
 * Rend le nombre de pages qu'un débordement de table laisse sans rang : jamais celles que le seul
 * budget de temps a reportées, qui ne débordent de rien.
 */
export function serveClaims(
  claims: WebgpuRowClaims,
  release: (page: number) => boolean,
  place: (page: number) => boolean,
) {
  if (!claims.count) return 0;
  claims.sort();
  const started = performance.now();
  let served = 0,
    denied = 0;
  while (served < claims.count) {
    const page = claims.pages[served];
    if (release(page)) {
      if (!place(page)) {
        denied = claims.count - served;
        break;
      }
      served++;
      if (performance.now() - started >= CLAIM_BUDGET_MS) break;
      continue;
    }
    served++;
  }
  claims.consume(served);
  return denied;
}
