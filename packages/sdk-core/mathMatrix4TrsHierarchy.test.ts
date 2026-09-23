// Parent/child cases of the math kernel: real `Object3D` chains from `three`, updated by
// `updateMatrixWorld(true)`, recomposed node by node with `composeMatrix4` and `multiplyMatrix4`
// (`chainesHostiles`, already written for the batch bench, reused here for bit-exact truth).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chainesHostiles,
  lectureReference,
  lectureSocle,
} from '../../bench/perf/browser/support/socleHierarchie.ts';

const CHAMPS = [
  'matrixWorld',
  'world position',
  'world quaternion',
  'world scale',
  'determinant',
  'determinant sign',
  'normal matrix',
  'inverse',
];

/** `Object.is` component by component; `NaN` accepted on both sides at the same place. */
function memeValeurs(a: unknown, b: unknown, chemin: string) {
  if (typeof a === 'number') {
    assert.ok(Object.is(a, b), `${chemin} : ${a} ≠ ${b}`);
    return;
  }
  const ta = a as ArrayLike<number>,
    tb = b as ArrayLike<number>;
  assert.equal(ta.length, tb.length, chemin);
  for (let i = 0; i < ta.length; i++)
    assert.ok(Object.is(ta[i], tb[i]), `${chemin}[${i}] : ${ta[i]} ≠ ${tb[i]}`);
}

test('hostile parent/child chains: the fixture covers the required cases', () => {
  const noeuds = chainesHostiles();
  assert.ok(noeuds.length > 100, `${noeuds.length} nodes, set too small`);

  const profondeur = (n: (typeof noeuds)[number]) => {
    let p = n,
      d = 0;
    while (p.parent >= 0) {
      p = noeuds[p.parent];
      d++;
    }
    return d;
  };
  assert.ok(Math.max(...noeuds.map(profondeur)) >= 3, 'no chain of depth ≥ 3');

  const enfantsPar = new Map<number, number>();
  for (const n of noeuds)
    if (n.parent >= 0) enfantsPar.set(n.parent, (enfantsPar.get(n.parent) ?? 0) + 1);
  assert.ok(
    [...enfantsPar.values()].some((c) => c >= 2),
    'no branch with two or more children',
  );

  assert.ok(
    noeuds.some((n) => n.echelle.filter((c) => c < 0).length === 1),
    'no negative scale on a single axis',
  );
  assert.ok(
    noeuds.some((n) => [...n.echelle].some((c) => c === 0)),
    'no zero scale',
  );
  assert.ok(
    noeuds.some(
      (n) =>
        n.parent >= 0 &&
        noeuds[n.parent].rotation.some((c, i) => c !== (i === 3 ? 1 : 0)) &&
        new Set(n.echelle).size > 1,
    ),
    'no node with non-uniform scale under a parent rotation',
  );
});

test('hostile parent/child chains: world, position, quaternion, scale, determinant, normal and inverse — bit-exact against `three`', () => {
  const noeuds = chainesHostiles();
  for (const [index, n] of noeuds.entries()) {
    const ref = lectureReference(n),
      socle = lectureSocle(n);
    for (let champ = 0; champ < CHAMPS.length; champ++)
      memeValeurs(ref[champ], socle[champ], `node ${index}, ${CHAMPS[champ]}`);
  }
});
