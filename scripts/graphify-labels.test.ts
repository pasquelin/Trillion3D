import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignNames,
  groupNodes,
  matchNames,
  renameNodes,
  rewriteReport,
  type Graph,
} from './graphify-labels.ts';

/** A tiny graph: two communities, and links that give each a dominant node. */
function graph(): Graph {
  return {
    nodes: [
      {
        id: 'a',
        label: 'hiz.ts',
        community: 7,
        source_file: 'packages/sdk-browser/src/hiz/hiz.ts',
      },
      {
        id: 'b',
        label: 'depth.ts',
        community: 7,
        source_file: 'packages/sdk-browser/src/hiz/depth.ts',
      },
      {
        id: 'c',
        label: 'split.ts',
        community: 7,
        source_file: 'packages/sdk-browser/src/hiz/split.ts',
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
  const { labels, recovered } = assignNames(graph(), { 'Hi-Z': ['a', 'b', 'c'] }, process.cwd());
  assert.equal(recovered, 1);
  assert.equal(labels.get(7), 'Hi-Z');
});

test('a community without witnesses takes its folder and dominant node', () => {
  assert.equal(assignNames(graph(), {}, process.cwd()).labels.get(3), 'image · png');
});

test('the fallback name comes from the most connected node, not the least', () => {
  const g = graph();
  g.links = [
    { source: 'b', target: 'a' },
    { source: 'b', target: 'c' },
  ];
  assert.equal(assignNames(g, {}, process.cwd()).labels.get(7), 'hiz · depth');
});

test('a file at the repository root counts under the root folder', () => {
  const g: Graph = {
    nodes: [{ id: 'r', label: 'README.md', community: 1, source_file: 'README.md' }],
    links: [],
  };
  assert.equal(assignNames(g, {}, process.cwd()).labels.get(1), 'root · README');
});

test('too weak an overlap does not take the name', () => {
  const witnesses = { 'PNG decoding': ['x', 'unknown1', 'unknown2', 'unknown3', 'unknown4'] };
  assert.equal(assignNames(graph(), witnesses, process.cwd()).recovered, 0);
});

test('two split communities do not bear the same name', () => {
  const g = graph();
  for (const n of g.nodes) n.community = n.id === 'x' || n.id === 'y' ? 3 : 7;
  const { labels } = assignNames(g, {}, process.cwd());
  assert.notEqual(labels.get(3), labels.get(7));
});

test('the strongest match is served first', () => {
  const { groups } = groupNodes(graph());
  const matched = matchNames(groups, { Weak: ['a', 'x', 'y'], Strong: ['a', 'b', 'c'] });
  assert.equal(matched.get(7), 'Strong');
});

test('the report sees only its community titles rewritten', () => {
  const labels = new Map([[7, 'Hi-Z']]);
  const after = rewriteReport(
    '### Community 7 - "hiz.ts"\nCohesion: 0.12\n### Community 9 - "x"\n',
    labels,
  );
  assert.match(after, /### Community 7 - "Hi-Z"/);
  assert.match(after, /### Community 9 - "x"/);
  assert.match(after, /Cohesion: 0\.12/);
});

test('the name returns into each node, where graphify query reads it', () => {
  const g = graph();
  const labels = new Map([
    [7, 'Hi-Z'],
    [3, 'PNG decoding'],
  ]);
  assert.equal(renameNodes(g, labels), 5);
  assert.equal(g.nodes.find((n) => n.id === 'x')!.community_name, 'PNG decoding');
  assert.equal(renameNodes(g, labels), 0);
});
