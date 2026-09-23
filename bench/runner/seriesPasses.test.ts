// Graphics card passes summarized by harness: one distribution per pass, one per
// comparable block, and "no metrics" remaining `null` — never a zero or empty array.
import test from 'node:test';
import assert from 'node:assert/strict';
import { passesGpu } from './seriesPasses.ts';
import { passes } from './summaryPasses.ts';
import type { GpuPassTimings } from '../../packages/sdk-core/src/index.ts';

const releve = (
  frame: number,
  liste: [string, number | null][],
  truncated = false,
): GpuPassTimings => ({
  frame,
  totalMs: null,
  truncated,
  passes: liste.map(([name, gpuMs]) => ({ name, gpuMs })),
});

test('each pass has its distribution, each block its own, on metrics where everything is measured', () => {
  const resume = passesGpu([
    releve(12, [
      ['Trillion3D DAG selection', 0.25],
      ['Trillion3D visibility primary', 1],
      ['Trillion3D material surfaces v1', 2],
      ['Trillion3D deferred lighting', 6],
    ]),
    releve(24, [
      ['Trillion3D DAG selection', 0.75],
      ['Trillion3D visibility primary', 1.5],
      ['Trillion3D material surfaces v1', 2.5],
      ['Trillion3D deferred lighting', 7],
    ]),
    releve(36, [
      ['Trillion3D DAG selection', null],
      ['Trillion3D visibility primary', 2],
      ['Trillion3D material surfaces v1', 3],
      ['Trillion3D deferred lighting', 8],
    ]),
  ]);
  if (!resume) throw new Error('expected a summary');
  assert.equal(resume.releves, 3);
  const parNom = Object.fromEntries(resume.passes.map((p) => [p.name, p]));
  // Harness p50 rank is that of `summarize`: on two values, the lower one.
  assert.deepEqual(
    [parNom['Trillion3D DAG selection'].gpuMs!.p50, parNom['Trillion3D DAG selection'].gpuMs!.max],
    [0.25, 0.75],
    'reading without duration does not count as zero',
  );
  assert.equal(parNom['Trillion3D DAG selection'].bloc, 'visibility');
  assert.equal(parNom['Trillion3D deferred lighting'].bloc, 'other');
  assert.equal(resume.passes[0].name, 'Trillion3D deferred lighting', 'heaviest first');
  // Visibility block is measured only on the two metrics where selection has a duration.
  assert.deepEqual([resume.blocs.visibilityMs!.p50, resume.blocs.visibilityMs!.max], [1.25, 2.25]);
  assert.equal(resume.blocs.materialsMs!.p50, 2.5, 'all three metrics count for this block');
  assert.equal(resume.blocs.otherMs!.p50, 7);
});

test('a truncated metric is ignored completely, and without any metric summary is null', () => {
  const resume = passesGpu([
    releve(12, [['Trillion3D visibility primary', 1]], true),
    releve(24, [['Trillion3D visibility primary', 3.0]]),
  ]);
  if (!resume) throw new Error('expected a summary');
  assert.equal(resume.releves, 2);
  assert.equal(resume.passes[0].gpuMs!.p50, 3.0);
  assert.equal(passesGpu([]), null);
  assert.equal(passesGpu(undefined), null);
});

test('readable summary names blocks in p50/p95 milliseconds and "unmeasured" without inventing', () => {
  const lignes = passes(
    passesGpu([
      releve(12, [
        ['Trillion3D visibility primary', 1.234],
        ['Trillion3D material surfaces v1', null],
      ]),
    ]),
  );
  assert.match(lignes[0], /Visibility buffer 1\.234 \/ 1\.234/);
  assert.match(lignes[0], /Materials pass unmeasured/);
  assert.match(lignes[0], /The rest unmeasured/);
  assert.ok(lignes.includes('| Trillion3D visibility primary | 1.234 / 1.234 | visibility |'));
  assert.deepEqual(passes(null), ['- GPU passes: no reading', '']);
});
