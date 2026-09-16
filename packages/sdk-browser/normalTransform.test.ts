// Défaut 9 (`NORMAL_TRANSFORM_WGSL`, standardLighting.ts) : la transformation des normales
// d'éclairage portait sa propre copie de `inverseTranspose3`, avec le seuil absolu `abs(det)<1e-20`
// sur le déterminant brut que le défaut 6 avait déjà corrigé dans le noyau de sélection. Une
// rotation d'échelle uniforme s a pour déterminant ±s³ : dès s ≲ 2,15e-7 la normale rendue était la
// normale LOCALE, non tournée, et la surface était éclairée comme si elle n'avait pas tourné.
// Le correctif n'est pas une seconde variante : les deux shaders lisent le même texte
// (`inverseTransposeWgsl.ts`). Ce test tient cette écriture unique ; l'arithmétique f32 elle-même
// est tenue par `gpuDagInverseTranspose.test.ts`, le GPU réel par
// `test/normaleEclairagePetiteEchelle.browser.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INVERSE_TRANSPOSE_WGSL } from './inverseTransposeWgsl.ts';
import { NORMAL_TRANSFORM_WGSL } from './standardLighting.ts';
import { DAG_SELECTION_SHADER } from './gpuDagShader.ts';

const occurrences = (texte: string, motif: RegExp) => texte.match(motif)?.length ?? 0;

test('les normales d’éclairage ne jugent plus la dégénérescence sur le déterminant brut', () => {
  assert.doesNotMatch(NORMAL_TRANSFORM_WGSL, /abs\(det\)<1e-20/, 'seuil absolu encore présent');
  assert.match(NORMAL_TRANSFORM_WGSL, /let a=m\[0\]\/t;let b=m\[1\]\/t;let c=m\[2\]\/t;/);
  assert.match(NORMAL_TRANSFORM_WGSL, /fini&&abs\(det\)>1e-20/);
  assert.match(NORMAL_TRANSFORM_WGSL, /return select\(v,p\.facteur\*\(p\.adj\*v\),p\.regulier\);/);
});

// Le prologue — normalisation, déterminant, adjointe — ne dépend que de la matrice : l'ombrage du
// tampon de visibilité le calcule une fois par pixel et applique les trois normales du triangle
// dessus. L'écriture reste unique, seul l'endroit où on la coupe a changé.
test('la préparation ne dépend que de la matrice, l’application que du vecteur', () => {
  assert.match(INVERSE_TRANSPOSE_WGSL, /fn invTranspose3Prep\(m:mat3x3f\)->InvT3\{/);
  assert.match(INVERSE_TRANSPOSE_WGSL, /fn invTranspose3Apply\(p:InvT3,v:vec3f\)->vec3f\{/);
  assert.doesNotMatch(
    INVERSE_TRANSPOSE_WGSL.split('fn invTranspose3Apply')[1].split('\n}')[0],
    /\bm\b|cross|det/,
    'l’application par vecteur ne doit rien recalculer de la matrice',
  );
});

test('le noyau de sélection et l’éclairage lisent la même écriture, au caractère près', () => {
  for (const [nom, shader] of [
    ['éclairage', NORMAL_TRANSFORM_WGSL],
    ['sélection du DAG', DAG_SELECTION_SHADER],
  ] as const) {
    assert.ok(shader.includes(INVERSE_TRANSPOSE_WGSL), `${nom} : texte partagé absent`);
    assert.equal(occurrences(shader, /fn inverseTranspose3/g), 1, `${nom} : déclaration en double`);
  }
});

test('la normale d’éclairage passe bien par l’inverse-transposée partagée', () => {
  assert.match(
    NORMAL_TRANSFORM_WGSL,
    /fn xformNormal\(world:mat4x4f,n:vec3f\)->vec3f\{\n return normalize\(inverseTranspose3\(mat3x3f\(world\[0\]\.xyz,world\[1\]\.xyz,world\[2\]\.xyz\),n\)\);/,
  );
});
