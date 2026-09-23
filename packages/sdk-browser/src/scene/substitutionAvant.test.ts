// What reconstructing the pre-batch form is worth, in the reproduction benches of
// defects 6 and 9 (`tests/browser/probes/inverse-transposee-petite-echelle.ts` and
// `normale-eclairage-petite-echelle.ts`).
//
// THE PREVIOUS STATE, for the record: both benches rebuilt the pre-batch shader with
// `texte.replace(INVERSE_TRANSPOSE_WGSL, INVERSE_TRANSPOSE_AVANT_WGSL)`, guarded by a single
// `assert.notEqual(resultat, texte)`. That guard catches the case where the shipped block is no
// longer found — so the substitution was not complete silence — but it only says "something
// moved": it lets a partial substitution through (shipped block present twice, only the first
// replaced) and a crooked substitution (`$&`, `` $` ``, `$'`, `$$` interpreted in the
// replacement). In both cases the bench replays a shader that is NOT the pre-batch one,
// and concludes on it.
//
// `substitutionAvant.ts` replaces that guard with a proof. This test keeps its failure messages:
// a substitution that does not happen must say which case we are in, and where to go.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAG_SELECTION_SHADER } from '../gpu/dag/shader/shader.ts';
import {
  INVERSE_TRANSPOSE_BEFORE_WGSL,
  INVERSE_TRANSPOSE_WGSL,
} from '../math/inverseTransposeWgsl.ts';
import { NORMAL_TRANSFORM_WGSL } from '../lighting/standardLighting.ts';
import { substitueFormeAvant } from '../../../../tests/browser/probes/substitutionAvant.ts';

const ORIGINE = 'packages/sdk-browser/src/math/inverseTransposeWgsl.ts';
const SEUIL_ABSOLU = 'abs(det)<1e-20';
const reel = (texte: string, name: string) => ({
  texte,
  livre: INVERSE_TRANSPOSE_WGSL,
  before: INVERSE_TRANSPOSE_BEFORE_WGSL,
  name,
  origine: ORIGINE,
  marqueur: SEUIL_ABSOLU,
});

test('on the two real shaders, substitution yields the pre-batch form', () => {
  for (const [name, texte] of [
    ['DAG selection', DAG_SELECTION_SHADER],
    ['lighting', NORMAL_TRANSFORM_WGSL],
  ] as const) {
    const before = substitueFormeAvant(reel(texte, name));
    assert.ok(before.includes(SEUIL_ABSOLU), `${name}: the absolute threshold did not come back`);
    assert.ok(
      !texte.includes(SEUIL_ABSOLU),
      `${name}: the shipped text still carries the threshold`,
    );
    assert.equal(
      before.length,
      texte.length - INVERSE_TRANSPOSE_WGSL.length + INVERSE_TRANSPOSE_BEFORE_WGSL.length,
    );
  }
});

/** The call must throw, and the message must contain that fragment. */
function echoue(options: Parameters<typeof substitueFormeAvant>[0], fragment: string) {
  assert.throws(
    () => substitueFormeAvant(options),
    (erreur: Error) => {
      assert.ok(
        erreur.message.includes(fragment),
        `message without "${fragment}": ${erreur.message}`,
      );
      assert.ok(erreur.message.includes(ORIGINE), `message without the origin: ${erreur.message}`);
      return true;
    },
  );
}

test('shipped block not found: the bench stops instead of replaying the fixed text', () => {
  // The case that counts: the kernel moved and the previous constant no longer matches it. Without
  // a guard, `replace` returns the unchanged text and the bench measures the FIXED version on both sides.
  echoue(
    { ...reel(DAG_SELECTION_SHADER, 'shader without the block'), livre: 'fn jamaisEcrite(){}' },
    'appears 0 times',
  );
});

test('shipped block present twice: the substitution would be partial', () => {
  echoue(
    reel(`${DAG_SELECTION_SHADER}\n${INVERSE_TRANSPOSE_WGSL}`, 'shader with doubled block'),
    'appears 2 times',
  );
});

test('a "$" in the previous form: the raw replace pastes crookedly, this one does not', () => {
  // `$&` is the matched text: a raw `replace(livre, avant)` pastes the SHIPPED block into the
  // "previous shader", which then replays the fixed version in the middle of the defect. The
  // function-based replace, itself, reads no `$`.
  const avecDollar = `${INVERSE_TRANSPOSE_BEFORE_WGSL}\n// $&`;
  const naif = DAG_SELECTION_SHADER.replace(INVERSE_TRANSPOSE_WGSL, avecDollar);
  assert.ok(naif.includes(INVERSE_TRANSPOSE_WGSL), 'the raw replace did not interpret "$&"');
  const sain = substitueFormeAvant({
    ...reel(DAG_SELECTION_SHADER, 'previous form with $&'),
    before: avecDollar,
  });
  assert.ok(
    !sain.includes(INVERSE_TRANSPOSE_WGSL),
    'the shipped block stayed in the previous shader',
  );
  assert.ok(sain.includes('// $&'), 'the "$&" must stay the text it is');
  assert.equal(
    sain.length,
    DAG_SELECTION_SHADER.length - INVERSE_TRANSPOSE_WGSL.length + avecDollar.length,
  );
});

test('a previous form that no longer carries the marker reproduces nothing', () => {
  echoue(
    {
      ...reel(DAG_SELECTION_SHADER, 'previous form without threshold'),
      before: INVERSE_TRANSPOSE_WGSL,
    },
    'both blocks are the same text',
  );
  echoue(
    {
      ...reel(DAG_SELECTION_SHADER, 'watered-down previous form'),
      before: INVERSE_TRANSPOSE_BEFORE_WGSL.replace(SEUIL_ABSOLU, 'abs(det)<1e-30'),
    },
    `no longer carries « ${SEUIL_ABSOLU} »`,
  );
});

test('the previous form already present in the text: this is no longer a reproduction', () => {
  const dejaAvant = DAG_SELECTION_SHADER.replace(
    INVERSE_TRANSPOSE_WGSL,
    () => INVERSE_TRANSPOSE_BEFORE_WGSL,
  );
  echoue(reel(dejaAvant, 'shader already rolled back'), 'appears 0 times');
});
