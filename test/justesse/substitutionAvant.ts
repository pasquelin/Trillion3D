// Put back, in a shipped shader, the WGSL block from before a lot — without the
// substitution succeeding halfway or failing in silence.
//
// What a raw `texte.replace(livre, avant)` does not say, and a reproduction bench
// must know:
//   — `String.prototype.replace` on a STRING pattern only replaces the FIRST
//     occurrence: if the shipped block appears twice, the second stays fixed and
//     the "previous shader" is an assembly of both versions, reproducing something
//     other than the defect;
//   — replacement interprets `$&`, `` $` ``, `$'`, `$$` and `$<name>`: a previous
//     block carrying a `$` would paste crookedly;
//   — if the shipped block is no longer found, `replace` returns the text unchanged:
//     reproduction would then replay the FIXED text believing it replays the defect,
//     and the bench would conclude "the defect no longer reproduces" on a shader
//     that was never modified.
// `assert.notEqual(resultat, texte)` only catches the last of those three cases, and
// even then: it only says something moved, not that it is the expected block that moved.
//
// This function establishes the substitution instead of hoping for it: occurrences
// counted before and after, replacement by FUNCTION — `replace(livre, () => avant)`,
// the only form where no `$` of the replacement is interpreted — and exact round-trip:
// substituting the shipped block back for the previous one must return the original
// text, character for character. It also requires that the previous block carry the
// marker that MAKES the reproduction (the threshold, the formula, what the lot changed)
// and that the shipped block no longer carry it: a reproduction that no longer
// reproduces reassures wrongly.
import assert from 'node:assert/strict';

/** Number of occurrences of `bloc` in `texte`, without overlap. */
function occurrences(texte: string, bloc: string): number {
  let compte = 0;
  for (let i = texte.indexOf(bloc); i >= 0; i = texte.indexOf(bloc, i + bloc.length)) compte++;
  return compte;
}

/**
 * Returns `texte` with `livre` replaced by `avant`, or fails naming exactly what is
 * missing. `nom` names the treated text and `origine` the file where both blocks live,
 * so the message says where to go when the kernel has moved. `marqueur` is the fragment
 * that distinguishes the previous form from the shipped one.
 */
export function substitueFormeAvant({
  texte,
  livre,
  before,
  name,
  origine,
  marqueur,
}: {
  texte: string;
  livre: string;
  before: string;
  name: string;
  origine: string;
  marqueur: string;
}): string {
  const ou = `${name}: both forms come from ${origine}`;
  assert.notEqual(
    livre,
    before,
    `${ou} — both blocks are the same text, there is nothing to replay`,
  );
  assert.ok(
    before.includes(marqueur),
    `${ou} — the previous form no longer carries « ${marqueur} »`,
  );
  assert.ok(!livre.includes(marqueur), `${ou} — the shipped form still carries « ${marqueur} »`);
  assert.equal(
    occurrences(texte, livre),
    1,
    `${ou} — the shipped block appears ${occurrences(texte, livre)} times in ${name} instead of ` +
      `once: substituting would only replace the first and the "previous shader" would be a ` +
      `mix of both versions`,
  );
  assert.equal(
    occurrences(texte, before),
    0,
    `${ou} — the previous form is ALREADY in ${name}: this is no longer a reproduction`,
  );
  const resultat = texte.replace(livre, () => before);
  assert.equal(occurrences(resultat, before), 1, `${ou} — the previous form was not inserted`);
  assert.equal(occurrences(resultat, livre), 0, `${ou} — the shipped form stayed in place`);
  assert.equal(
    resultat.replace(before, () => livre),
    texte,
    `${ou} — the round-trip does not return the original text: the substitution touched ` +
      `something other than the expected block`,
  );
  return resultat;
}
