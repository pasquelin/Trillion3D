// Summary memory section: a total per side and per view, three named families, the rest
// by difference, the heaviest labels, and nothing invented when registry is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoire } from './rapportMemoire.mjs';

const serie = (view, sides) => ({ view, pixelError: 1, sides });

test('each side of each view has its row, and the rest is the difference', () => {
  const lignes = memoire({
    series: [
      serie('sol', {
        apres: {
          metrics: {
            gpuAllocatedBytes: 7_500_000_000,
            texturePoolBytes: 6_688_572_304,
            geometryAllocationBytes: 400_000_000,
            gpuFrameTargetBytes: 275_700_000,
            geometryPoolBytes: 536_870_912,
            geometryPoolClamp: 'scene',
            gpuAllocationsUnknownFormat: 0,
            gpuAllocatedByLabel: {
              'WG material atlas rgba8unorm classe 0': 4_252_572_304,
              'WG geometry page cache': 300_000_000,
              unlabelled: 12,
            },
          },
        },
      }),
    ],
  });
  assert.equal(
    lignes[2],
    '| sol | e1 | apres | 7.500 GB | 6.689 GB | 0.400 GB / 536.9 MB (scene) | 275.7 MB | 0.136 GB |',
  );
  assert.equal(lignes[3], '');
  assert.equal(
    lignes[4],
    '- sol · e1 · apres, heaviest: WG material atlas rgba8unorm classe 0 4252.6 MB, ' +
      'WG geometry page cache 300.0 MB, unlabelled 0.0 MB',
  );
});

test('a side without registry is unmeasured, never zero, and an unknown format is stated', () => {
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
    '| generale | e1 | avant | unmeasured | unmeasured | unmeasured / unmeasured | unmeasured | unmeasured |',
  );
  assert.equal(
    lignes[3],
    '| generale | e1 | apres | 0.000 GB | unmeasured | unmeasured / unmeasured | unmeasured | 0.000 GB |',
  );
  assert.equal(lignes.length, 6);
  assert.match(lignes[5], /^- generale · e1 · apres, heaviest: WG HDR lighting 0.0 MB — 2 texture/);
  assert.match(lignes[5], /this total is not a proof$/);
});
