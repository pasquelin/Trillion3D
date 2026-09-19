/**
 * Restores domain names erased by reclustering to graphify graph communities.
 *
 * `graphify update .` renumbers communities on each pass and rewrites
 * `.graphify_labels.json` with the name of the most connected node of each group.
 * Hand-written names drop. This script attaches them no longer to a number — which survives
 * nothing — but to content: `graphify-communautes.json` keeps twelve witnesses per named
 * community, and the name returns to the group containing the most.
 *
 * Unmatched communities take `folder · dominant node`, readable if not domain-specific.
 * Three files carry the name: `.graphify_labels.json` for exports, the `community_name`
 * field of each graph node for `graphify query`, and `### Community N` titles in the report.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export const OVERLAP_THRESHOLD = 0.4;
const EXTENSIONS = /\.(ts|tsx|js|mjs|rs|py|md|txt|wgsl|json)$/;

/** Groups node IDs by community, and counts links for each. */
export function groupNodes(graph) {
  const degree = new Map();
  for (const link of graph.links)
    for (const end of [link.source, link.target]) degree.set(end, (degree.get(end) ?? 0) + 1);
  const groups = new Map();
  for (const node of graph.nodes) {
    if (!groups.has(node.community)) groups.set(node.community, []);
    groups.get(node.community).push(node.id);
  }
  return { groups, degree };
}

/** Fallback name: dominant folder of group, then its most connected node. */
export function derivedName(ids, context) {
  const { degree, labelMap, sources, root } = context;
  const head = ids.reduce((a, b) => ((degree.get(b) ?? 0) >= (degree.get(a) ?? 0) ? a : b));
  const name = (labelMap.get(head) ?? head).replace(EXTENSIONS, '').replace(/\(\)$/, '').trim();
  const folders = new Map();
  for (const id of ids) {
    const filePath = sources.get(id);
    if (!filePath) continue;
    const relativePath = isAbsolute(filePath) ? relative(root, filePath) : filePath;
    const folder = basename(dirname(relativePath)) || 'root';
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  const dominant = [...folders].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  if (dominant && !name.toLowerCase().includes(dominant.toLowerCase()))
    return `${dominant} · ${name}`;
  return name || 'Unnamed community';
}

/**
 * Assigns each curated name to the community containing the most of its witnesses.
 * Stronger matches pass first: a name is set only once, and an already named
 * community does not let itself be reclaimed by a weaker candidate.
 */
export function matchNames(groups, witnesses) {
  const scores = [];
  // Membership depends only on community: build once per community, not once per (name, community).
  const membersOf = new Map([...groups].map(([cid, ids]) => [cid, new Set(ids)]));
  for (const [name, references] of Object.entries(witnesses)) {
    for (const [cid] of groups) {
      const members = membersOf.get(cid);
      const sharedCount = references.filter((id) => members.has(id)).length;
      const share = sharedCount / references.length;
      if (share >= OVERLAP_THRESHOLD) scores.push({ name, cid, share });
    }
  }
  scores.sort((a, b) => b.share - a.share);
  const byCommunity = new Map();
  const takenNames = new Set();
  for (const { name, cid } of scores) {
    if (byCommunity.has(cid) || takenNames.has(name)) continue;
    byCommunity.set(cid, name);
    takenNames.add(name);
  }
  return byCommunity;
}

/** Two split communities can target the same name: we number them to distinguish them. */
function disambiguate(labels) {
  const seen = new Map();
  for (const cid of [...labels.keys()].sort((a, b) => a - b)) {
    const name = labels.get(cid);
    const rank = (seen.get(name) ?? 0) + 1;
    seen.set(name, rank);
    if (rank > 1) labels.set(cid, `${name} (${rank})`);
  }
  return labels;
}

/** Rewrites `### Community N - "…"` report titles with recovered names. */
export function rewriteReport(report, labels) {
  return report.replace(/^### Community (\d+) - ".*"$/gm, (line, number) => {
    const name = labels.get(Number(number));
    return name ? `### Community ${number} - "${name}"` : line;
  });
}

/** Re-writes the name in each node: this is where `graphify query` and `explain` read it. */
export function renameNodes(graph, labels) {
  let changed = 0;
  for (const node of graph.nodes) {
    const name = labels.get(node.community);
    if (name && node.community_name !== name) {
      node.community_name = name;
      changed += 1;
    }
  }
  return changed;
}

export function assignNames(graph, witnesses, root) {
  const { groups, degree } = groupNodes(graph);
  const context = {
    degree,
    root,
    labelMap: new Map(graph.nodes.map((n) => [n.id, n.label ?? n.id])),
    sources: new Map(graph.nodes.map((n) => [n.id, n.source_file ?? ''])),
  };
  const matched = matchNames(groups, witnesses);
  const labels = new Map();
  for (const [cid, ids] of groups) labels.set(cid, matched.get(cid) ?? derivedName(ids, context));
  return { labels: disambiguate(labels), recovered: matched.size, total: groups.size };
}

function main() {
  const root = process.cwd();
  const graphPath = 'graphify-out/graph.json';
  if (!existsSync(graphPath)) {
    console.log('[graphify] no graph: nothing to rename.');
    return;
  }
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const witnesses = JSON.parse(readFileSync('scripts/graphify-communautes.json', 'utf8'));
  const { labels, recovered, total } = assignNames(graph, witnesses, root);

  const byNumber = Object.fromEntries([...labels].map(([cid, name]) => [String(cid), name]));
  writeFileSync('graphify-out/.graphify_labels.json', JSON.stringify(byNumber));
  const nodes = renameNodes(graph, labels);
  if (nodes) writeFileSync(graphPath, JSON.stringify(graph));
  const report = 'graphify-out/GRAPH_REPORT.md';
  if (existsSync(report))
    writeFileSync(report, rewriteReport(readFileSync(report, 'utf8'), labels));
  console.log(`[graphify] ${recovered}/${total} communities recovered their domain names.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
