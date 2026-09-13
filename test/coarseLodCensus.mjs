#!/usr/bin/env node
/** Measure a complete, infinitely permissive LOD cut from a real compiled cache.
 * Usage: node test/coarseLodCensus.mjs /absolute/path/to/manifest.json [output.json]
 * Counts instances from source.gltf nodes, matching a full-scene source traversal.
 * This is a cache census, not a render performance or image-quality measurement.
 */
import {createHash} from 'node:crypto';
import {createReadStream, readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, isAbsolute} from 'node:path';

if (!process.argv[2]) throw new Error('Pass the compiled manifest.json or clusters.json path');
const input = resolve(process.argv[2]);
const output = process.argv[3] ? resolve(process.argv[3]) : null;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileHash(path) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}
const pointerBytes = readFileSync(input);
const pointer = JSON.parse(pointerBytes);
const cachePath = pointer.primitives ? input : resolve(dirname(input), pointer.url);
const cacheBytes = readFileSync(cachePath);
const cache = JSON.parse(cacheBytes);
const sourcePath = resolve(dirname(cachePath), 'source.gltf');
const sourceBytes = readFileSync(sourcePath);
const source = JSON.parse(sourceBytes);
const instances = new Map();
for (const [node, item] of source.nodes.entries()) {
  if (item.mesh !== undefined) {
    const entries = instances.get(item.mesh) ?? [];
    entries.push({node, name: item.name ?? null});
    instances.set(item.mesh, entries);
  }
}
const addCosts = costs => costs.reduce((sum, cost) => ({
  triangles: sum.triangles + cost.triangles,
  pages: sum.pages + cost.pages,
}), {triangles: 0, pages: 0});
const rootComparisons = [];
const hierarchyDiagnostics = {nodesWithCoarsePages: 0, nodesWithoutCoarsePages: 0, nonReducingParents: 0};
const rows = cache.primitives.map(primitive => {
  const pages = new Map(primitive.pages.map(page => [page.id, page]));
  const pageCost = ids => ({triangles: ids.reduce((sum, id) => {
    const page = pages.get(id);
    if (!page || !Number.isInteger(page.count / 3)) throw new Error(`Invalid page ${primitive.mesh}/${primitive.primitive}/${id}`);
    return sum + page.count / 3;
  }, 0), pages: ids.length});
  function coarsestCut(node) {
    if (!node) return [];
    if (node.coarsePages?.length) return node.coarsePages;
    if (node.page !== undefined) return [node.page];
    if (!node.children?.length) throw new Error('Hierarchy does not provide a complete cover');
    return node.children.flatMap(coarsestCut);
  }
  function minimumCut(node) {
    if (!node) return {triangles: 0, pages: 0};
    const descendants = node.children?.length ? addCosts(node.children.map(minimumCut)) : node.page !== undefined ? pageCost([node.page]) : null;
    if (!node.coarsePages?.length) {
      hierarchyDiagnostics.nodesWithoutCoarsePages++;
      if (!descendants) throw new Error('Hierarchy does not provide a complete cover');
      return descendants;
    }
    hierarchyDiagnostics.nodesWithCoarsePages++;
    const coarse = pageCost(node.coarsePages);
    if (descendants && coarse.triangles >= descendants.triangles) hierarchyDiagnostics.nonReducingParents++;
    return descendants && (descendants.triangles < coarse.triangles || (descendants.triangles === coarse.triangles && descendants.pages < coarse.pages)) ? descendants : coarse;
  }
  const cut = coarsestCut(primitive.hierarchy);
  if (new Set(cut).size !== cut.length) throw new Error('Duplicate page within complete cover');
  const cost = pageCost(cut);
  const minimumCost = minimumCut(primitive.hierarchy);
  const instanceNodes = instances.get(primitive.mesh) ?? [];
  const multiplier = instanceNodes.length;
  const exact = primitive.pages.filter(page => page.role === 'exact');
  const allCoarse = primitive.pages.filter(page => page.role === 'coarse');
  const selectedExact = cut.filter(id => pages.get(id).role === 'exact');
  const selectedCoarse = cut.filter(id => pages.get(id).role === 'coarse');
  const material = source.materials?.[primitive.material];
  const rootCoarse = !!primitive.hierarchy?.coarsePages?.length;
  if (rootCoarse) {
    const childIds = primitive.hierarchy.children?.length ? primitive.hierarchy.children.flatMap(coarsestCut) : primitive.hierarchy.page !== undefined ? [primitive.hierarchy.page] : [];
    rootComparisons.push({mesh: primitive.mesh, primitive: primitive.primitive, instances: multiplier, root: cost, completeChildren: pageCost(childIds), errorObject: primitive.hierarchy.errorObject});
  }
  return {
    mesh: primitive.mesh, primitive: primitive.primitive, meshName: source.meshes[primitive.mesh].name ?? null,
    material: primitive.material, materialName: material?.name ?? null, alphaMode: material?.alphaMode ?? 'OPAQUE',
    pass: primitive.pass, instances: multiplier, instanceNodes,
    sourceTrianglesUnique: primitive.triangles, sourceTrianglesInstantiated: primitive.triangles * multiplier,
    rootHasCoarseRepresentation: rootCoarse,
    coarsestTrianglesUnique: cost.triangles, coarsestTrianglesInstantiated: cost.triangles * multiplier,
    coarsestPagesUnique: cost.pages, coarsestPagesInstantiated: cost.pages * multiplier,
    coarsestExactPagesInstantiated: selectedExact.length * multiplier,
    coarsestCoarsePagesInstantiated: selectedCoarse.length * multiplier,
    minimumTrianglesInstantiated: minimumCost.triangles * multiplier,
    minimumPagesInstantiated: minimumCost.pages * multiplier,
    selectedPageIds: cut,
    allExactPagesUnique: exact.length, allCoarsePagesUnique: allCoarse.length,
    exactPageContentDigest: hash(JSON.stringify(exact.map(page => ({start: page.start, count: page.count, sha256: page.sha256})))),
    topology: primitive.topology ?? null,
  };
});
const opaqueRows = rows.filter(row => row.pass === 'exact-clusters');
const sum = (list, field) => list.reduce((total, row) => total + row[field], 0);
const aggregate = list => ({
  uniquePrimitives: list.length, instantiatedPrimitives: sum(list, 'instances'),
  sourceTrianglesUnique: sum(list, 'sourceTrianglesUnique'), sourceTrianglesInstantiated: sum(list, 'sourceTrianglesInstantiated'),
  coarsestTrianglesUnique: sum(list, 'coarsestTrianglesUnique'), coarsestTrianglesInstantiated: sum(list, 'coarsestTrianglesInstantiated'),
  coarsestPagesUnique: sum(list, 'coarsestPagesUnique'), coarsestPagesInstantiated: sum(list, 'coarsestPagesInstantiated'),
  coarsestExactPagesInstantiated: sum(list, 'coarsestExactPagesInstantiated'), coarsestCoarsePagesInstantiated: sum(list, 'coarsestCoarsePagesInstantiated'),
  minimumTrianglesInstantiated: sum(list, 'minimumTrianglesInstantiated'), minimumPagesInstantiated: sum(list, 'minimumPagesInstantiated'),
});
const sourceBuffers = [];
for (const buffer of source.buffers ?? []) {
  if (!buffer.uri || buffer.uri.startsWith('data:') || buffer.uri.includes('://')) continue;
  const path = isAbsolute(buffer.uri) ? buffer.uri : resolve(dirname(sourcePath), buffer.uri);
  sourceBuffers.push({path, declaredBytes: buffer.byteLength, sha256: await fileHash(path)});
}
const summary = {
  measuredAt: new Date().toISOString(), measurement: 'complete-coarsest-cache-cut-before-culling',
  scope: 'all source.gltf mesh-node instances, exact-clusters pass (OPAQUE and MASK; excludes shared-blend)',
  visualQuality: 'not-run', framePerformance: 'not-run',
  provenance: {
    pointerPath: input, pointerSha256: hash(pointerBytes), cachePath, cacheSha256: hash(cacheBytes),
    cacheKey: cache.key, compilerVersion: cache.compilerVersion, clusterStrategy: cache.clusterStrategy, errorModel: cache.errorModel,
    sourcePath, sourceSha256: hash(sourceBytes), sourceBuffers,
    exactPageContentDigest: hash(JSON.stringify(rows.map(row => [row.mesh, row.primitive, row.exactPageContentDigest]))),
    materialDefinitionDigest: hash(JSON.stringify(source.materials ?? [])),
    nodeDefinitionDigest: hash(JSON.stringify(source.nodes ?? [])),
  },
  totalMeshNodes: [...instances.values()].reduce((total, entries) => total + entries.length, 0),
  sourceTrianglesInstantiated: sum(rows, 'sourceTrianglesInstantiated'),
  opaque: aggregate(opaqueRows),
  opaqueWithRootCoarse: aggregate(opaqueRows.filter(row => row.rootHasCoarseRepresentation)),
  opaqueWithoutRootCoarse: aggregate(opaqueRows.filter(row => !row.rootHasCoarseRepresentation)),
  sharedBlend: {uniquePrimitives: rows.length - opaqueRows.length, sourceTrianglesInstantiated: sum(rows.filter(row => row.pass !== 'exact-clusters'), 'sourceTrianglesInstantiated')},
  hierarchyDiagnostics,
  theoreticalLowerBound: {
    note: 'One nonempty page per primitive instance is only a combinatorial lower bound, not an achievable quality-preserving simplification target.',
    instantiatedPages: sum(opaqueRows, 'instances'),
  },
  topTriangleOffenders: [...opaqueRows].sort((a, b) => b.coarsestTrianglesInstantiated - a.coarsestTrianglesInstantiated).slice(0, 20).map(({instanceNodes, selectedPageIds, topology, ...row}) => row),
  rootComparisons,
  primitives: rows,
};
if (output) writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({output, provenance: summary.provenance, opaque: summary.opaque, opaqueWithoutRootCoarse: summary.opaqueWithoutRootCoarse, hierarchyDiagnostics, topTriangleOffenders: summary.topTriangleOffenders.slice(0, 5)}, null, 2));
