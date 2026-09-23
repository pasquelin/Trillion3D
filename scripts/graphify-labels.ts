/**
 * Gives the communities of the knowledge graph (`graphify-out/`) back the domain names a
 * reclustering erased: `pnpm run graphify:libelles`, after `graphify update .`.
 *
 * `graphify update .` renumbers the communities on each pass and names each one after its most
 * connected node, so hand-written names drop. A name is attached here to content instead of a
 * number: `scripts/graphify-communautes.json`, kept local beside the graph, lists witnesses per
 * named community, and the name returns to the group holding the most of them. A community that
 * matches no name takes `folder · dominant node`. Three places carry the name: the labels file
 * for exports, the `community_name` of each node for `graphify query`, and the report titles.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const OVERLAP_THRESHOLD = 0.4;
const EXTENSIONS = /\.(ts|tsx|js|mjs|rs|py|md|txt|wgsl|json)$/;

export interface GraphNode {
  id: string;
  label?: string;
  community: number;
  source_file?: string;
  community_name?: string;
}
export interface Graph {
  nodes: GraphNode[];
  links: Array<{ source: string; target: string }>;
}
/** Curated name -> the node ids that witness it. */
export type Witnesses = Record<string, string[]>;

/** Node ids per community, and the number of links of each node. */
export function groupNodes(graph: Graph) {
  const degree = new Map<string, number>();
  for (const link of graph.links)
    for (const end of [link.source, link.target]) degree.set(end, (degree.get(end) ?? 0) + 1);
  const groups = new Map<number, string[]>();
  for (const node of graph.nodes) {
    if (!groups.has(node.community)) groups.set(node.community, []);
    groups.get(node.community)!.push(node.id);
  }
  return { groups, degree };
}

interface NamingContext {
  degree: Map<string, number>;
  labelMap: Map<string, string>;
  sources: Map<string, string>;
  root: string;
}

/** Fallback name: the dominant folder of the group, then its most connected node. */
function derivedName(ids: string[], context: NamingContext): string {
  const { degree, labelMap, sources, root } = context;
  const head = ids.reduce((a, b) => ((degree.get(b) ?? 0) > (degree.get(a) ?? 0) ? b : a));
  const name = (labelMap.get(head) ?? head).replace(EXTENSIONS, '').replace(/\(\)$/, '').trim();
  const folders = new Map<string, number>();
  for (const id of ids) {
    const filePath = sources.get(id);
    if (!filePath) continue;
    const relativePath = isAbsolute(filePath) ? relative(root, filePath) : filePath;
    const directory = dirname(relativePath);
    const folder = directory === '.' ? 'root' : basename(directory);
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  const dominant = [...folders].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  if (dominant && !name.toLowerCase().includes(dominant.toLowerCase()))
    return `${dominant} · ${name}`;
  return name || 'Unnamed community';
}

/**
 * Each curated name goes to the community holding the most of its witnesses. The strongest
 * matches pass first: a name is set once, and a named community is not reclaimed by a weaker one.
 */
export function matchNames(groups: Map<number, string[]>, witnesses: Witnesses) {
  const scores: Array<{ name: string; cid: number; share: number }> = [];
  const membersOf = new Map([...groups].map(([cid, ids]) => [cid, new Set(ids)]));
  for (const [name, references] of Object.entries(witnesses))
    for (const [cid] of groups) {
      const members = membersOf.get(cid)!;
      const share = references.filter((id) => members.has(id)).length / references.length;
      if (share >= OVERLAP_THRESHOLD) scores.push({ name, cid, share });
    }
  scores.sort((a, b) => b.share - a.share);
  const byCommunity = new Map<number, string>();
  const takenNames = new Set<string>();
  for (const { name, cid } of scores) {
    if (byCommunity.has(cid) || takenNames.has(name)) continue;
    byCommunity.set(cid, name);
    takenNames.add(name);
  }
  return byCommunity;
}

/** Two split communities can reach the same name: they are numbered apart. */
function disambiguate(labels: Map<number, string>) {
  const seen = new Map<string, number>();
  for (const cid of [...labels.keys()].sort((a, b) => a - b)) {
    const name = labels.get(cid)!;
    const rank = (seen.get(name) ?? 0) + 1;
    seen.set(name, rank);
    if (rank > 1) labels.set(cid, `${name} (${rank})`);
  }
  return labels;
}

/** Rewrites the `### Community N - "…"` titles of the report with the recovered names. */
export function rewriteReport(report: string, labels: Map<number, string>): string {
  return report.replace(/^### Community (\d+) - ".*"$/gm, (line, number: string) => {
    const name = labels.get(Number(number));
    return name ? `### Community ${number} - "${name}"` : line;
  });
}

/** Writes the name into each node, where `graphify query` and `explain` read it. */
export function renameNodes(graph: Graph, labels: Map<number, string>): number {
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

export function assignNames(graph: Graph, witnesses: Witnesses, root: string) {
  const { groups, degree } = groupNodes(graph);
  const context: NamingContext = {
    degree,
    root,
    labelMap: new Map(graph.nodes.map((n) => [n.id, n.label ?? n.id])),
    sources: new Map(graph.nodes.map((n) => [n.id, n.source_file ?? ''])),
  };
  const matched = matchNames(groups, witnesses);
  const labels = new Map<number, string>();
  for (const [cid, ids] of groups) labels.set(cid, matched.get(cid) ?? derivedName(ids, context));
  return { labels: disambiguate(labels), recovered: matched.size, total: groups.size };
}

function main() {
  const graphPath = 'graphify-out/graph.json';
  if (!existsSync(graphPath)) {
    console.log('[graphify] no graph: nothing to rename.');
    return;
  }
  const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as Graph;
  const witnessPath = 'scripts/graphify-communautes.json';
  const witnesses: Witnesses = existsSync(witnessPath)
    ? JSON.parse(readFileSync(witnessPath, 'utf8'))
    : {};
  const { labels, recovered, total } = assignNames(graph, witnesses, process.cwd());
  const byNumber = Object.fromEntries([...labels].map(([cid, name]) => [String(cid), name]));
  writeFileSync('graphify-out/.graphify_labels.json', JSON.stringify(byNumber));
  if (renameNodes(graph, labels)) writeFileSync(graphPath, JSON.stringify(graph));
  const report = 'graphify-out/GRAPH_REPORT.md';
  if (existsSync(report))
    writeFileSync(report, rewriteReport(readFileSync(report, 'utf8'), labels));
  console.log(`[graphify] ${recovered}/${total} communities recovered their domain names.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
