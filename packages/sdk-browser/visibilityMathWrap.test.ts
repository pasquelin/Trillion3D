// Défaut 4 : `wrapTexel` (visibilityMath.ts) doit suivre la règle entière de la carte graphique pour
// les trois modes d'adressage — la même que MIRRORED_REPEAT en OpenGL ES 3.0 / WebGPU : i = ⌊t·taille⌋,
// puis serrage, modulo une période (Repeat), ou modulo deux périodes dont la seconde se lit à rebours
// (MirroredRepeat). `texelThree` (bench/justesse/adressageCas.mjs) encode cette même règle de façon
// indépendante ; c'est l'oracle déjà vérifié contre les vrais échantillonneurs WebGL2 et WebGPU par
// `bench/justesse/adressage-gpu.mjs`, réutilisé ici pour balayer des cas que les valeurs figées
// n'écrivent pas explicitement.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { wrapTexel } from './visibilityMath.ts';
import { texelThree } from './bench/justesse/adressageCas.mjs';

const CLAMP = THREE.ClampToEdgeWrapping,
  REPEAT = THREE.RepeatWrapping,
  MIRROR = THREE.MirroredRepeatWrapping;

test('u = 1,25 sur 4 texels en miroir lit le texel 2 : ce que la carte graphique lit réellement', () => {
  assert.equal(wrapTexel(1.25, 4, MIRROR), 2);
  assert.equal(texelThree(1.25, 4, MIRROR), 2, 'la référence indépendante confirme le même texel');
});

test('les trois modes contre la référence, tailles paire et impaire, entiers/négatifs/demi-texel/grands', () => {
  const valeurs = [
    -1000.5, -1000, -3, -2, -1, -0.5, 0, 0.125, 0.5, 0.875, 1, 1.5, 2, 3, 999.5, 1000,
  ];
  for (const taille of [4, 5])
    for (const wrap of [CLAMP, REPEAT, MIRROR])
      for (const t of valeurs)
        assert.equal(
          wrapTexel(t, taille, wrap),
          texelThree(t, taille, wrap),
          `taille=${taille} wrap=${wrap} t=${t}`,
        );
});

test('u et v traités séparément : tailles et modes indépendants par axe', () => {
  const u = [
    [1.25, 4, MIRROR],
    [-0.6, 5, REPEAT],
    [3.4, 4, CLAMP],
  ] as const;
  const v = [
    [-1.25, 5, MIRROR],
    [1.75, 4, REPEAT],
    [-2.2, 5, CLAMP],
  ] as const;
  for (const [tu, tailleU, wrapU] of u)
    for (const [tv, tailleV, wrapV] of v) {
      assert.equal(wrapTexel(tu, tailleU, wrapU), texelThree(tu, tailleU, wrapU), `u=${tu}`);
      assert.equal(wrapTexel(tv, tailleV, wrapV), texelThree(tv, tailleV, wrapV), `v=${tv}`);
    }
});

test('Repeat et ClampToEdge : valeurs figées, inchangées depuis avant ce lot', () => {
  assert.equal(wrapTexel(0.1, 4, REPEAT), 0);
  assert.equal(wrapTexel(0.9, 4, REPEAT), 3);
  assert.equal(wrapTexel(1.1, 4, REPEAT), 0);
  assert.equal(wrapTexel(-0.1, 4, REPEAT), 3);
  assert.equal(wrapTexel(-2, 4, CLAMP), 0);
  assert.equal(wrapTexel(0.5, 4, CLAMP), 2);
  assert.equal(wrapTexel(2, 4, CLAMP), 3);
});
