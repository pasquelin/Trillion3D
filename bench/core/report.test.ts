// The regression gate of `rapport`, run in a child against a baseline this test writes: a case
// past `FAILURE_THRESHOLD` of its recorded median fails the benchmark, one within it passes, and a
// domain without a baseline says the gate is off instead of passing as "nothing slowed down".
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { baselinePath, fragmentPath, dossierBaselines } from './paths.ts'

const median = process.env.GATE_MEDIAN
if (median !== undefined) {
  const { rapport } = await import('./report.ts')
  const [medianMs, name] = [Number(median), 'one case']
  const stats = {
    medianeMs: medianMs,
    p95Ms: medianMs,
    minMs: medianMs,
    tours: 1,
    nsParElement: null,
  }
  const verdict = {
    opsParSec: null,
    temoin: null,
    ecartTemoin: null,
    correct: null,
    difference: null,
  }
  rapport(process.env.GATE_DOMAIN!, {
    name: 'gated',
    fichier: 'bench/core/report.ts',
    resultats: [{ name, size: null, motif: null, ...stats, ...verdict }],
  })
} else {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const domaine = `gate-test-${process.pid}`
  const run = (median: number, domain = domaine) =>
    spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url)], {
      env: { ...env, GATE_MEDIAN: String(median), GATE_DOMAIN: domain },
      encoding: 'utf8',
    })
  const baseline = {
    version: 3,
    domaine,
    commit: null,
    date: '',
    machine: '',
    node: '',
    resultats: [{ cle: 'gated | one case', size: null, medianeMs: 1, p95Ms: null, minMs: null }],
  }

  test('a case 30 % slower than its baseline fails; 20 % passes; no baseline says so', () => {
    mkdirSync(dossierBaselines, { recursive: true })
    writeFileSync(baselinePath(domaine), JSON.stringify(baseline))
    try {
      const slower = run(1.3)
      assert.notEqual(slower.status, 0, 'the gate let a 30 % regression through')
      assert.match(slower.stdout, /gated \| one case: \+30\.0 %/)
      assert.equal(run(1.2).status, 0, 'a 20 % change is a warning, not a failure')
      const none = run(9, `${domaine}-none`)
      assert.equal(none.status, 0)
      assert.match(none.stdout, /no baseline on this machine, the regression gate is off/)
    } finally {
      for (const d of [domaine, `${domaine}-none`]) rmSync(fragmentPath(d), { force: true })
      rmSync(baselinePath(domaine), { force: true })
    }
  })
}
