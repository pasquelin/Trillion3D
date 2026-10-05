// The cut rule run by the WGSL kernel itself, on the synthetic DAG of the rule's tests with pages
// missing (#486): on every frame the pages `dagMask` flags drawn are those the kernel's CPU model
// draws, and they cover each leaf exactly once. Full residency is the witness frame; the random
// frames are where a page is missing and the nearest resident ancestor must stand in for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverFault, ruleDag } from '../../../packages/sdk-browser/src/page/cut/cutRule.fixture.ts';
import {
  oracleBackend,
  stripUniforms,
} from '../../../packages/sdk-browser/src/page/cut/cutRuleBackends.fixture.ts';
import { seeded } from '../kit/randomDraw.ts';
import { runSelectionKernel } from './selectionKernel.ts';

const THRESHOLD = 0.1,
  FRAMES = 12;

test('the kernel draws its CPU model’s cut, each leaf once, whatever pages are missing', async () => {
  const dag = ruleDag(256);
  const model = oracleBackend(dag, THRESHOLD);
  const isRoot = (page: number) => dag.pages[page].group === null;
  // Full residency, then frames with pages removed at random; the roots always stay.
  const next = seeded(486);
  const frames = Array.from({ length: FRAMES }, (_, frame) => {
    const keep = frame ? 0.3 + 0.6 * next() : 1;
    return Uint8Array.from(dag.pages, (_, page) => (isRoot(page) || next() < keep ? 1 : 0));
  });
  const { adapter, readings } = await runSelectionKernel(
    frames.map((resident, frame) => {
      // One packing per frame: residency writes each node's open count into its nodes.
      const { packed, uniforms } = stripUniforms(dag, THRESHOLD);
      return { name: `frame ${frame}`, packed, uniforms, resident };
    }),
  );
  const rows = frames.map((resident, frame) => ({
    frame,
    missing: resident.length - resident.reduce((n, v) => n + v, 0),
    drawn: readings[frame].drawn,
    expected: [...model(resident).drawn].sort((a, b) => a - b),
  }));
  console.log(
    JSON.stringify({
      adapter,
      frames: rows.map(({ frame, missing, drawn }) => ({ frame, missing, drawn: drawn.length })),
    }),
  );
  assert.ok(
    rows.some((row) => row.missing > 0),
    'no frame misses a page: the proof covers nothing',
  );
  for (const { frame, drawn, expected } of rows) {
    assert.ok(drawn.length > 0, `frame ${frame}: the kernel draws nothing`);
    const fault = coverFault(dag, drawn);
    assert.equal(fault, -1, `frame ${frame}: leaf ${fault} not covered exactly once`);
    assert.deepEqual(drawn, expected, `frame ${frame}: the kernel and its model draw otherwise`);
  }
});
