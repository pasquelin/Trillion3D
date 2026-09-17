// Le recyclage d'une ligne de la table de pages, prouvé DIRECTEMENT.
//
// `sourceRowOf` (webgpuRowCommit.ts) rend la ligne où l'image précédente a écrit une page, ou -1
// quand elle ne peut plus être reprise telle quelle. Sa garde `rowPageIndex[source] !== pageIndex`
// couvre l'alias : la page P a quitté la coupe, sa ligne a été reprise par une autre page, et
// `rowOfPage[P]` la nomme encore. Si P revient à L'OFFSET QUE CETTE LIGNE PORTE MAINTENANT — ce qui
// arrive dès qu'une fente de cache est rendue puis reprise —, l'offset et l'époque concordent tous
// les deux, et sans la garde la ligne est « reprise telle quelle » : elle continue de décrire
// l'autre grappe pendant que la table la donne pour P.
//
// Aucune comparaison différentielle ne peut le dire : l'oracle d'avant le lot F porte la même
// fonction au mot près (`bench/oracles/f-lignes.mjs`), donc les deux côtés se tromperaient ensemble.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_INFO_STRIDE } from './visibilityTypes.ts';
import { image, monte, offsetsPar } from './webgpuRowCommitFixture.ts';

const MOTS = PAGE_INFO_STRIDE / 4;

test('une ligne reprise par une autre page ne peut pas être héritée à son nouvel offset', () => {
  const monté = monte();
  const { rows } = monté;
  const plan = (offsets: (page: number) => number) => ({
    offsets: offsetsPar(offsets),
    coupeProcesseur: true,
  });
  // La page 0 tient l'offset 0, la page 1 l'offset 8.
  image(
    monté,
    plan((p) => (p === 0 ? 0 : p === 1 ? 8 : -1)),
  );
  const ligne = rows.rowOfPage[0];
  assert.ok(ligne >= 0, 'la page 0 tient une ligne');
  // La page 0 sort, la page 3 prend l'offset 0 : les rangs se resserrent et la ligne de la page 0
  // revient à la page 1, qui porte l'offset 8.
  image(
    monté,
    plan((p) => (p === 1 ? 8 : p === 3 ? 0 : -1)),
  );
  assert.equal(rows.rowOfPage[0], ligne, 'le rang inverse de la page sortie reste tel quel');
  assert.equal(rows.rowPageIndex[ligne], 1, 'la ligne décrit désormais une autre page');
  const offsetUsurpe = rows.rowOffsetWords[ligne];
  // La page 1 sort à son tour, et la page 0 revient EXACTEMENT à l'offset que sa vieille ligne porte.
  image(
    monté,
    plan((p) => (p === 0 ? offsetUsurpe : p === 3 ? 0 : -1)),
  );
  // Chaque ligne décrit sa propre page, dans l'état comme dans les mots que la carte lit.
  for (let row = 0; row < rows.rowCount; row++) {
    const page = rows.rowPageIndex[row];
    assert.equal(rows.rowOfPage[page], row, `ligne ${row} : rang inverse de la page ${page}`);
    assert.equal(
      (rows.pageTableInts as Uint32Array)[row * MOTS + 4],
      monté.pages[page].id,
      `ligne ${row} : la table nomme la page ${page}`,
    );
    assert.equal(rows.rowOffsetWords[row], rows.residentOffsetWords[page], `ligne ${row} : offset`);
  }
});
