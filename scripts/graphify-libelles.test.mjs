import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignNames,
  rewriteReport,
  matchNames,
  groupNodes,
  renameNodes,
} from './graphify-libelles.mjs';

/** A tiny graph: two communities, links giving a dominant node. */
function graph() {
  return {
    nodes: [
      { id: 'a', label: 'hiz.ts', community: 7, source_file: 'packages/sdk-browser/hiz.ts' },
      {
        id: 'b',
        label: 'hizDepth.ts',
        community: 7,
        source_file: 'packages/sdk-browser/hizDepth.ts',
      },
      {
        id: 'c',
        label: 'hizSplit.ts',
        community: 7,
        source_file: 'packages/sdk-browser/hizSplit.ts',
      },
      {
        id: 'x',
        label: 'png.rs',
        community: 3,
        source_file: 'packages/acr/src/plugins/image/png.rs',
      },
      { id: 'y', label: 'PNG', community: 3, source_file: 'packages/acr/src/plugins/image/png.rs' },
    ],
    links: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'x', target: 'y' },
    ],
  };
}

test('a curated name follows its witnesses even when the community is renumbered', () => {
  const witnesses = { 'Hi-Z pyramid and occlusion': ['a', 'b', 'c'] };
  const { labels, recovered } = assignNames(graph(), witnesses, process.cwd());
  assert.equal(recovered, 1);
  assert.equal(labels.get(7), 'Hi-Z pyramid and occlusion');
});

test('a community without witnesses takes its folder and dominant node', () => {
  const { labels } = assignNames(graph(), {}, process.cwd());
  assert.equal(labels.get(3), 'image · png');
});

test('too weak overlap does not steal the name', () => {
  const witnesses = { 'PNG decoding': ['x', 'inconnu1', 'inconnu2', 'inconnu3', 'inconnu4'] };
  const { recovered } = assignNames(graph(), witnesses, process.cwd());
  assert.equal(recovered, 0);
});

test('two split communities do not bear the same name', () => {
  const g = graph();
  for (const n of g.nodes) n.community = n.id === 'x' || n.id === 'y' ? 3 : 7;
  const witnesses = {};
  const { labels } = assignNames(g, witnesses, process.cwd());
  assert.notEqual(labels.get(3), labels.get(7));
});

test('the strongest match is served before others', () => {
  const { groups } = groupNodes(graph());
  const matched = matchNames(groups, { Faible: ['a', 'x', 'y'], Franc: ['a', 'b', 'c'] });
  assert.equal(matched.get(7), 'Franc');
});

test('the report sees only its community titles rewritten', () => {
  const labels = new Map([[7, 'Hi-Z pyramid and occlusion']]);
  const before = '### Community 7 - "hiz.ts"\nCohesion: 0.12\n### Community 9 - "other"\n';
  const after = rewriteReport(before, labels);
  assert.match(after, /### Community 7 - "Hi-Z pyramid and occlusion"/);
  assert.match(after, /### Community 9 - "other"/);
  assert.match(after, /Cohesion: 0\.12/);
});

test('the name returns into each node, where graphify query reads it', () => {
  const g = graph();
  const labels = new Map([
    [7, 'Hi-Z pyramid and occlusion'],
    [3, 'PNG decoding'],
  ]);
  assert.equal(renameNodes(g, labels), 5);
  assert.equal(g.nodes.find((n) => n.id === 'a').community_name, 'Hi-Z pyramid and occlusion');
  assert.equal(g.nodes.find((n) => n.id === 'x').community_name, 'PNG decoding');
  assert.equal(renameNodes(g, labels), 0);
});
