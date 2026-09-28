// Acceptance-only image proof; no timings. Run after merge with the other real-renderer proofs.
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../support/enginePageProof.ts';
import type { MirrorCase } from '../support/screenMirrorPage.ts';

const result = await preuveDansLaPage('screenMirrorPage.ts', 'screenMirror', 'Screen mirrors');
preuveSaine(result);
const cases = (result as typeof result & { cases: MirrorCase[] }).cases;
assert.equal(cases.length, 16, 'both renderers, arrangements, alpha passes and camera projections');
const carries = (rgb: number[], channel: number) =>
  rgb[channel] > 50 && rgb[channel] > Math.max(...rgb.filter((_, k) => k !== channel)) + 30;
for (const entry of cases) {
  const label = JSON.stringify({ path: entry.path, ...entry.options });
  for (const sequence of [entry.sharp, entry.transition, entry.rough]) {
    assert.equal(sequence.length, 3, label);
    for (const reading of sequence) assert.equal(reading.stable, 0, `${label}: stable A/A`);
  }
  for (const sequence of [entry.sharp, entry.transition]) {
    for (const step of [0, 1]) {
      for (const channel of [0, 1]) {
        assert.ok(carries(sequence[step].direct[channel], channel), `${label}: direct source`);
        assert.ok(carries(sequence[step].reflected[channel], channel), `${label}: analytic reflection`);
        assert.ok(!carries(entry.rough[step].reflected[channel], channel), `${label}: rough control`);
      }
    }
    assert.ok(!carries(sequence[1].old, 0), `${label}: old reflection cleared after moving`);
    assert.ok(!carries(sequence[2].old, 0), `${label}: offscreen source cannot leave a reflection`);
    assert.ok(carries(sequence[2].reflected[1], 1), `${label}: untouched green reflection survives`);
  }
}
console.log(JSON.stringify({ cases, proof: 'production mirrors with bounce disabled' }, null, 2));
