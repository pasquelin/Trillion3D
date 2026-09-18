// La section mémoire du résumé : un total par côté et par vue, trois familles nommées, le reste
// par différence, les étiquettes les plus lourdes, et rien d'inventé quand le registre manque.
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoire } from './rapportMemoire.mjs';

const serie = (view, sides) => ({ view, pixelError: 1, sides });

test('chaque côté de chaque vue a sa ligne, et le reste est la différence', () => {
  const lignes = memoire({
    series: [
      serie('sol', {
        apres: {
          metrics: {
            gpuAllocatedBytes: 7_500_000_000,
            textureAtlasBytesCalculated: 6_688_572_304,
            geometryAllocationBytes: 400_000_000,
            gpuFrameTargetBytes: 275_700_000,
            gpuFrameBudgetBytes: 301_989_888,
            gpuAllocationsUnknownFormat: 0,
            gpuAllocatedByLabel: {
              'WG material atlas rgba8unorm classe 0': 4_252_572_304,
              'WG geometry page cache': 300_000_000,
              'sans étiquette': 12,
            },
          },
        },
      }),
    ],
  });
  assert.equal(
    lignes[2],
    '| sol | e1 | apres | 7.500 Go | 6.689 Go | 0.400 Go | 275.7 Mo / 302.0 Mo | 0.136 Go |',
  );
  assert.equal(lignes[3], '');
  assert.equal(
    lignes[4],
    '- sol · e1 · apres, les plus lourdes : WG material atlas rgba8unorm classe 0 4252.6 Mo, ' +
      'WG geometry page cache 300.0 Mo, sans étiquette 0.0 Mo',
  );
});

test('un côté sans registre est non mesuré, jamais à zéro, et un format inconnu se dit', () => {
  const lignes = memoire({
    series: [
      serie('generale', {
        avant: { metrics: {} },
        apres: {
          metrics: {
            gpuAllocatedBytes: 1_000,
            gpuAllocationsUnknownFormat: 2,
            gpuAllocatedByLabel: { 'WG HDR lighting': 1_000 },
          },
        },
      }),
    ],
  });
  assert.equal(
    lignes[2],
    '| generale | e1 | avant | non mesuré | non mesuré | non mesuré | non mesuré / non mesuré | non mesuré |',
  );
  assert.equal(
    lignes[3],
    '| generale | e1 | apres | 0.000 Go | non mesuré | non mesuré | non mesuré / non mesuré | 0.000 Go |',
  );
  assert.equal(lignes.length, 6);
  assert.match(
    lignes[5],
    /^- generale · e1 · apres, les plus lourdes : WG HDR lighting 0.0 Mo — 2 texture/,
  );
  assert.match(lignes[5], /ce total n'est pas une preuve$/);
});
