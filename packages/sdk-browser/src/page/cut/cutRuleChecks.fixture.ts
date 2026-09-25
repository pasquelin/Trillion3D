/**
 * The invariants the cut rule's tests check on one frame of a synthetic DAG (`cutRule.fixture.ts`),
 * whatever backend drew it (`cutRuleBackends.fixture.ts`): every leaf covered exactly once, by the
 * cluster the cut wants or its nearest ancestor the rule's residency holds (#483 rule 1).
 */
import assert from 'node:assert/strict';
import { coverFault, type RuleDag } from './cutRule.fixture.ts';
import type { CutBackend } from './cutRuleBackends.fixture.ts';
import { createCutReadiness } from './readiness.ts';

/** The cut `develop` drew at full residency on `ruleDag(256)` before the view-bounded tables
 *  (b114cd29b), on every backend alike: its size and the FNV-1a hash of its sorted page list, per
 *  threshold (#483 rule 2). */
export const DEVELOP_FULL_CUT: Record<number, string> = {
  0.05: '93:35de1ee8',
  0.1: '56:7db7dfa7',
  0.3: '28:9f4a010b',
  1: '14:701c5fb6',
};

/** A reproducible sequence in [0, 1). */
export function random(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

export function ruleChecks(dag: RuleDag) {
  const isRoot = (page: number) => dag.pages[page].group === null;

  /** The cluster covering unit `u` one level above `page`: the output of its group that holds `u`. */
  function parentAt(page: number, u: number) {
    const g = dag.pages[page].group!,
      s = dag.structure;
    for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
      const [a, b] = dag.pages[s.outputs[i]].units;
      if (a <= u && u < b) return s.outputs[i];
    }
    throw new Error(`no parent of ${page} covers ${u}`);
  }

  /** For each leaf unit, the cluster the rule must draw there: the wanted one, or its nearest
   *  ancestor the cut rule's residency holds. */
  function expectedAt(wanted: number[], ready: Uint8Array) {
    const at = new Int32Array(dag.leaves);
    for (const w of wanted) {
      const [a, b] = dag.pages[w].units;
      for (let u = a; u < b; u++) {
        let c = w;
        while (!ready[c]) c = parentAt(c, u);
        at[u] = c;
      }
    }
    return at;
  }

  function readinessOf(resident: Uint8Array) {
    const r = createCutReadiness(dag.structure, dag.culling.links);
    resident.forEach((v, page) => r.set(page, v === 1));
    r.settle();
    return Uint8Array.from(dag.pages, (_, page) => (r.isReady(page) ? 1 : 0));
  }

  /** The three invariants, on one frame. */
  function check(name: string, cut: { drawn: number[]; wanted: number[] }, resident: Uint8Array) {
    assert.equal(coverFault(dag, cut.drawn), -1, `${name}: a leaf is not covered exactly once`);
    const expected = expectedAt(cut.wanted, readinessOf(resident));
    for (const page of cut.drawn) {
      const [a, b] = dag.pages[page].units;
      for (let u = a; u < b; u++)
        assert.equal(page, expected[u], `${name}: unit ${u} drawn by ${page}, not ${expected[u]}`);
    }
  }

  const full = () => new Uint8Array(dag.pages.length).fill(1);

  function digest(pages: readonly number[]) {
    const text = [...pages].sort((a, b) => a - b).join(',');
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++)
      hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
    return `${pages.length}:${hash.toString(16)}`;
  }

  /** Forty frames, pages removed at random, the three invariants checked on each. */
  function randomFrames(cut: CutBackend) {
    const next = random(486);
    for (let frame = 0; frame < 40; frame++) {
      const keep = 0.3 + 0.6 * next();
      const resident = full().map((_, p) => (isRoot(p) || next() < keep ? 1 : 0));
      check(`frame ${frame}`, cut(resident), resident);
    }
  }
  return { isRoot, check, full, randomFrames, digest };
}
