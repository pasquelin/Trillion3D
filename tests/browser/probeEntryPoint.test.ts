// A Node import of a probe never opens Chromium (AGENTS.md rule 2): the page harness refuses
// unless a probe or a render proof of `test:gpu` is the process's entry point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RACINE, listBrowserTests, listJustesseTests } from './test-gpu.ts';
import { assertProofEntryPoint, dansPageWebgpu } from './probes/pageWebgpu.ts';

test('only a probe or a render proof run as the entry point may open Chromium', () => {
  for (const proof of [listJustesseTests()[0], listBrowserTests()[0]])
    assert.doesNotThrow(() => assertProofEntryPoint(join(RACINE, proof)));
  const absent = join(RACINE, 'tests/browser/probes/absent-probe.ts');
  for (const entry of ['', fileURLToPath(import.meta.url), absent])
    assert.throws(() => assertProofEntryPoint(entry), /Chromium refused/);
});

test('a harness call from a unit test is refused before any server or browser', async () => {
  await assert.rejects(
    dansPageWebgpu(() => 1, null),
    /Chromium refused: the entry point .*probeEntryPoint\.test\.ts/,
  );
});
