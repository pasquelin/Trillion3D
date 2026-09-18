// Les lignes textures du résumé : les seize compteurs du pool nommés, les octets lisibles, rien d'inventé.
import test from 'node:test';
import assert from 'node:assert/strict';
import { textures } from './rapportTextures.mjs';

test('les seize compteurs des textures virtuelles se lisent en trois lignes', () => {
  const [pool, retour, diffuseur, , vide] = textures({
    texturePoolBytes: 532_684_800,
    texturePoolLayers: 4,
    textureTilesResident: 1_212,
    textureResidentBytes: 89_668_608,
    textureTilesRequested: 640,
    textureTilesAtLevel: 612,
    textureMissingLevels: 0.125,
    textureTilesPending: 28,
    textureTilesServed: 3_410,
    textureTilesEvicted: 12,
    textureTilesRefused: 0,
    textureBytesLastFrame: 16_722_688,
    textureLevelReads: 2,
    textureLevelsDecoded: 118,
    textureLevelCacheBytes: 150_994_944,
    textureScratchBuilds: 0,
  });
  assert.equal(
    pool,
    '- Textures : pool 0.533 Go calculés, 4 couche(s) par atlas ; résident 0.090 Go en 1212 tuiles',
  );
  assert.equal(
    retour,
    "- Retour d'image : 640 tuiles demandées, 612 servies au niveau demandé, 0.13 niveau(x) de " +
      'retard en moyenne, 28 en attente',
  );
  assert.equal(
    diffuseur,
    '- Diffuseur : 3410 tuiles servies, 12 évincées, 0 refusées ; dernière passe 16.7 Mo ; niveaux ' +
      'cuits 2 en lecture, 118 décodés, 151.0 Mo tenus ; 0 textures de travail',
  );
  assert.equal(vide, '');
});

test('la préparation et le réseau se lisent en secondes et en Go par sorte de fichier', () => {
  const [, , , ligne] = textures({}, { preparationMs: 2345.6, reseau: { png: 1.2e9, bin: 2e8 } });
  assert.equal(
    ligne,
    '- Préparation 2.35 s ; réseau depuis la préparation : png 1.200 Go, bin 0.200 Go',
  );
  const [, , , absente] = textures({}, {});
  assert.equal(absente, '- Préparation non mesurée ; réseau depuis la préparation : non mesuré');
});

test('un moteur qui ne publie pas les textures les dit non mesurées, jamais à zéro', () => {
  const [pool, retour, diffuseur] = textures({});
  assert.match(pool, /pool non mesuré calculés, non mesuré couche\(s\)/);
  assert.match(retour, /non mesuré tuiles demandées/);
  assert.match(diffuseur, /niveaux cuits non mesuré en lecture/);
  for (const ligne of [pool, retour, diffuseur]) assert.doesNotMatch(ligne, /\b0 (Go|Mo|tuiles)\b/);
  assert.equal(textures(null)[0], textures(undefined)[0]);
});
