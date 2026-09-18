// La ligne textures du résumé : les octets en Go lisibles, chaque compteur nommé, et rien d'inventé.
import test from 'node:test';
import assert from 'node:assert/strict';
import { textures } from './rapportTextures.mjs';

test('les compteurs textures du moteur se lisent en une ligne, en gigaoctets', () => {
  const [ligne, pompe, , vide] = textures({
    textureAtlasBytesCalculated: 6_688_572_304,
    textureAtlasClassBytesCalculated: [2_436_000_000, 4_252_572_304],
    textureAtlasClassesUsed: 2,
    textureResidentBytes: 4_985_237_364,
    textureBudgetBytes: 6_688_572_304,
    textureAtWantedLevel: 72,
    textureLayers: 127,
    textureMissingLevels: 0,
    textureEvictions: 0,
    textureUploaded: 336,
    texturePending: 12,
    textureInFlight: 3,
    textureSlicesUploaded: 4_812,
    textureLevelsUploaded: 1_005,
    textureSkipped: 0,
    textureBytesLastFrame: 16_777_216,
  });
  assert.equal(
    pompe,
    '- Pompe de textures : 336 transférées, 12 en file, 3 entamées, 4812 tranches, 1005 niveaux, ' +
      '0 sorties après refus ; dernière passe 16.8 Mo',
  );
  assert.equal(
    ligne,
    '- Textures : atlas 6.689 Go calculés sur 2 classe(s) (2.436 Go + 4.253 Go) ; engagés 4.985 Go ' +
      'sur un budget de 6.689 Go ; couches au niveau voulu 72 / 127 ; niveaux manquants 0 ; ' +
      'transferts défaits 0',
  );
  assert.equal(vide, '');
});

test('la préparation et le réseau se lisent en secondes et en Go par sorte de fichier', () => {
  const [, , ligne] = textures({}, { preparationMs: 2345.6, reseau: { png: 1.2e9, bin: 2e8 } });
  assert.equal(
    ligne,
    '- Préparation 2.35 s ; réseau depuis la préparation : png 1.200 Go, bin 0.200 Go',
  );
  const [, , absente] = textures({}, {});
  assert.equal(absente, '- Préparation non mesurée ; réseau depuis la préparation : non mesuré');
});

test('un moteur qui ne publie pas les textures les dit non mesurées, jamais à zéro', () => {
  const [ligne] = textures({});
  assert.match(ligne, /atlas non mesuré calculés sur non mesuré classe\(s\)/);
  assert.match(ligne, /couches au niveau voulu non mesuré \/ non mesuré/);
  assert.doesNotMatch(ligne, /\b0 Go\b/);
  assert.equal(textures(null)[0], textures(undefined)[0]);
});
