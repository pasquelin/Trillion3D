// Défaut 4 : un bit par axe, jamais les deux modes du même axe, aucun bit en serrage.
// Défaut 8 : chaque carte d'un matériau adresse sa texture dans son propre mode. La fiche de page
// porte donc un quartet par carte, et chaque lecture du nuanceur reçoit le quartet de la carte
// qu'elle échantillonne — pas les drapeaux du matériau, qui n'en portaient qu'un pour toutes.
// La preuve sur carte graphique réelle est le banc `bench/justesse/adressage-cartes-gpu.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WRAP_MAP,
  WRAP_S_MIRROR,
  WRAP_S_REPEAT,
  WRAP_T_MIRROR,
  WRAP_T_REPEAT,
  wrapModes,
  wrapNibble,
  wrapOf,
} from './visibilityWrapModes.ts';
import { visMaterial } from './visibilityTypes.ts';
import { ROW_WRAP_MODES_WORD } from './webgpuPageRow.ts';
import { SHADE_SHADER } from './visibilityShaderShade.ts';
import { BLEND_SHADER } from './webgpuBlendShader.ts';
import { MASK_KEEP_WGSL } from './visibilityPageWgsl.ts';
import { CARTES, ligneDePageMelangee, materielMelange } from './bench/justesse/adressageCartes.mjs';

const carte = (wrapS: THREE.Wrapping, wrapT: THREE.Wrapping) => ({ wrapS, wrapT }) as THREE.Texture;
/** Le quartet attendu d'une entrée de la fixture, recalculé depuis ses deux modes déclarés. */
const attendu = (c: (typeof CARTES)[number]) => wrapNibble(carte(c.wrapS, c.wrapT));

test('wrapNibble pose le bit de répétition ou de miroir par axe, aucun bit en serrage', () => {
  assert.equal(wrapNibble(undefined), 0, 'aucune carte');
  assert.equal(wrapNibble(carte(THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping)), 0);
  assert.equal(
    wrapNibble(carte(THREE.RepeatWrapping, THREE.RepeatWrapping)),
    WRAP_S_REPEAT | WRAP_T_REPEAT,
  );
  assert.equal(
    wrapNibble(carte(THREE.MirroredRepeatWrapping, THREE.MirroredRepeatWrapping)),
    WRAP_S_MIRROR | WRAP_T_MIRROR,
  );
  assert.equal(
    wrapNibble(carte(THREE.MirroredRepeatWrapping, THREE.RepeatWrapping)),
    WRAP_S_MIRROR | WRAP_T_REPEAT,
    'un mode différent par axe pose un bit différent par axe',
  );
  assert.equal(
    wrapNibble(carte(THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping)),
    WRAP_T_MIRROR,
    'S en serrage ne pose aucun bit S',
  );
});

test('wrapModes range le quartet de chaque carte à son rang, six cartes dans un mot', () => {
  const mot = wrapModes(visMaterial(materielMelange()));
  for (const entree of CARTES)
    assert.equal(wrapOf(mot, entree.carte), attendu(entree), `carte ${entree.nom}`);
  assert.equal(mot >>> 24, 0, 'six quartets tiennent dans les vingt-quatre bits bas');
});

test('la fiche de page porte le mode de chaque carte, pas celui de la seule carte de base', () => {
  const { ints } = ligneDePageMelangee();
  const lus = CARTES.map((entree) => wrapOf(ints[ROW_WRAP_MODES_WORD], entree.carte));
  for (const [i, entree] of CARTES.entries())
    assert.equal(lus[i], attendu(entree), `carte ${entree.nom} dans la fiche de page`);
  assert.equal(new Set(lus).size, CARTES.length, 'six cartes, six quartets distincts');
  // Le mot des drapeaux ne porte plus d'adressage : ses bits 32, 64, 32768 et 65536 sont libres.
  assert.equal(ints[23] & (32 | 64 | 32768 | 65536), 0);
});

/**
 * Le début de chaque lecture d'atlas des deux nuanceurs de production, jusqu'à son argument
 * d'adressage compris : c'est ce lien-là — cette carte-ci lue avec ce quartet-ci — que le défaut 8
 * rompait. Donner à une seule de ces lectures le quartet d'une autre carte fait échouer le test.
 */
const APPELS = {
  SHADE_SHADER: [
    `colorSample(page.mapIndex,page.uvScale,uv,wrapOf(page.wrapModes,${WRAP_MAP.base}u)`,
    `dataSample(page.roughnessIndex,page.roughUvScale,uv,wrapOf(page.wrapModes,${WRAP_MAP.rough}u)`,
    `dataSample(page.metalnessIndex,page.metalUvScale,uv,wrapOf(page.wrapModes,${WRAP_MAP.metal}u)`,
    `dataSample(page.normalIndex,page.normalUvScale,uv,wrapOf(page.wrapModes,${WRAP_MAP.normal}u)`,
    `dataSample(page.aoIndex,page.aoUvScale,uv,wrapOf(page.wrapModes,${WRAP_MAP.ao}u)`,
    `colorSample(page.emissiveIndex,page.emissiveUvScale,uv,wrapOf(page.wrapModes,${WRAP_MAP.emissive}u)`,
  ],
  // Le mélange lit maintenant la fiche de l'item en variables plates : les rangs de cartes arrivent
  // par `in.ids` et `in.maps`, et le mot d'adressage par `wrap`. Même lien vérifié : cette carte-ci
  // lue avec ce quartet-ci.
  BLEND_SHADER: [
    `colorSample(in.ids.x,in.uvA.xy,in.uv,wrapOf(wrap,${WRAP_MAP.base}u)`,
    `dataSample(in.maps.x,scales[in.maps.x].xy,in.uv,wrapOf(wrap,${WRAP_MAP.rough}u)`,
    `dataSample(in.maps.y,scales[in.maps.y].xy,in.uv,wrapOf(wrap,${WRAP_MAP.metal}u)`,
    `dataSample(in.maps.z,scales[in.maps.z].xy,in.uv,wrapOf(wrap,${WRAP_MAP.normal}u)`,
    `dataSample(in.maps.w,scales[in.maps.w].xy,in.uv,wrapOf(wrap,${WRAP_MAP.ao}u)`,
    `colorSample(in.ids.z,scales[in.ids.z].zw,in.uv,wrapOf(wrap,${WRAP_MAP.emissive}u)`,
  ],
};

for (const [nom, texte] of Object.entries({ SHADE_SHADER, BLEND_SHADER }))
  test(`${nom} donne à chaque lecture le quartet de sa propre carte`, () => {
    for (const appel of APPELS[nom as keyof typeof APPELS])
      assert.ok(texte.includes(appel), `lecture absente ou mal adressée : ${appel}`);
    assert.doesNotMatch(
      texte,
      /(?:colorSample|colorAlpha|dataSample)\([^)]*\.flags/,
      'aucune lecture ne doit reprendre les drapeaux du matériau comme adressage',
    );
  });

// `wrapModes` et les lectures des deux nuanceurs se dérivent maintenant de `WRAP_MAP`. Ce test tient
// la dérivation par l'autre bout : tout rang du mot est lu une fois, et une seule, dans chaque
// nuanceur. Une septième carte ajoutée à `WRAP_MAP` mais jamais lue adresserait en serrage sans que
// rien ne le dise — c'est ce silence-là qui échoue ici.
test('chaque rang de WRAP_MAP est lu une fois et une seule par les deux nuanceurs', () => {
  const fois = (texte: string, motif: string) => texte.split(motif).length - 1;
  for (const rang of Object.values(WRAP_MAP)) {
    assert.equal(fois(SHADE_SHADER, `wrapOf(page.wrapModes,${rang}u)`), 1, `rang ${rang}, ombrage`);
    assert.equal(fois(BLEND_SHADER, `wrapOf(wrap,${rang}u)`), 1, `rang ${rang}, lot transparent`);
  }
});

test('la découpe alpha adresse la carte de base par son quartet, jamais par les drapeaux', () => {
  assert.ok(
    MASK_KEEP_WGSL.includes(
      `colorAlpha(page.mapIndex,page.uvScale,uv,wrapOf(page.wrapModes,${WRAP_MAP.base}u))`,
    ),
  );
});
