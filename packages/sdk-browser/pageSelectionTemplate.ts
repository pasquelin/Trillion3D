import {
  BOX_VALUES,
  DAG_ERROR_MODEL,
  EngineError,
  boxEmpty,
  boxUnion,
  primitiveUsesClusterErrors,
  type Primitive,
} from '../sdk-core/index.ts';
import {
  clusterErrorFields,
  cullingNodes,
  streamPlacement,
  structureIndex,
} from './pageSelectionHelpers.ts';
import { cullingBounds } from './pageSelectionCutBounds.ts';
import { cullingLinks, type CullingLinks } from './pageSelectionCutForced.ts';

/**
 * What a source object carries once, however many times it is placed in the scene: error bands,
 * streaming bundles, cluster identities, the culling hierarchy and its bounds, group links, local
 * box. None of that depends on a placement's world matrix — two instances of the same object used
 * to hold two copies of it. Placements keep what belongs to them: a matrix, a draw rank, a mesh.
 *
 * The order of checks is the previous one, placement by placement: missing page, index coverage,
 * then the cache's error band. Only their count changes.
 */
type Template = {
  pages: Array<{
    array: Uint32Array | undefined;
    cut: ReturnType<typeof clusterErrorFields>;
    placed: { url: string; offset: number } | undefined;
    clusterId: string;
  }>;
  sourceOrder: number[];
  sourceOffset: number;
  complete: boolean;
  checked: ArrayLike<number> | undefined;
  shape: Shape | undefined;
};
type Shape = {
  structure: ReturnType<typeof structureIndex>;
  culling: ReturnType<typeof cullingNodes>;
  bounds: Float64Array | undefined;
  links: CullingLinks | undefined;
  local: Float64Array;
};

/** Multiset of the triangles of an index array: coverage is a multiset identity, never an
 *  order identity — the DAG reorders the triangles. */
function triangleCounts(arr: ArrayLike<number>) {
  const map = new Map<string, number>();
  for (let i = 0; i < arr.length; i += 3) {
    const key = `${arr[i]},${arr[i + 1]},${arr[i + 2]}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** Local box of a primitive: that of the root of its hierarchy, or the union of its pages. */
function localBox(primitive: Primitive, culling: ReturnType<typeof cullingNodes>) {
  const local = new Float64Array(BOX_VALUES);
  if (culling) {
    local.set(culling.nodes.subarray(0, BOX_VALUES));
    return local;
  }
  boxEmpty(local, 0);
  for (const page of primitive.pages)
    boxUnion(
      local,
      0,
      page.min[0],
      page.min[1],
      page.min[2],
      page.max[0],
      page.max[1],
      page.max[2],
    );
  return local;
}

/** Templates of a scene's primitives: each computed at the first placement, re-read afterwards. */
export function createPrimitiveTemplates(indices: Map<string, Uint32Array>, allowMissing: boolean) {
  const held = new Map<Primitive, Template>();
  return {
    /** Pages of a primitive: index array, error band, bundle, identity. */
    pagesOf(primitive: Primitive): Template {
      const kept = held.get(primitive);
      if (kept) return kept;
      const placement = streamPlacement(primitive.streams, primitive.pages);
      let sourceOffset = 0;
      const pages = primitive.pages.map((page, index) => {
        const array = indices.get(page.url);
        if (!array && !allowMissing && indices.size) throw new Error('Missing page');
        if ((page.role ?? 'exact') !== 'coarse') sourceOffset += array ? array.length : page.count;
        return {
          array,
          cut: clusterErrorFields(page),
          placed: placement?.[index],
          clusterId: `${primitive.mesh}/${primitive.primitive}/${page.id}`,
        };
      });
      const template: Template = {
        pages,
        // The source rank of a cluster depends only on the primitive; only a transparent mesh
        // reads it, and it reads it identically under each of its instances.
        sourceOrder: primitive.pages.map((page, index) => page.start ?? index),
        sourceOffset,
        complete: primitive.pages.every(
          (page) => indices.has(page.url) || (page.role ?? 'exact') === 'coarse',
        ),
        checked: undefined,
        shape: undefined,
      };
      held.set(primitive, template);
      return template;
    },
    /** Coverage, checked once per primitive / source-indices pair: two placements of the same
     *  object set the same geometry, therefore the same index array. */
    checkCoverage(primitive: Primitive, template: Template, src: ArrayLike<number>) {
      if (!template.complete || template.checked === src) return;
      const exact = primitive.pages.filter((page) => (page.role ?? 'exact') !== 'coarse');
      let total = 0;
      for (const page of exact) total += indices.get(page.url)!.length;
      const joined = new Uint32Array(total);
      let at = 0;
      for (const page of exact) {
        const part = indices.get(page.url)!;
        joined.set(part, at);
        at += part.length;
      }
      const fromPages = triangleCounts(joined),
        fromSource = triangleCounts(src);
      if (fromPages.size !== fromSource.size) throw new Error('Incomplete cluster coverage');
      for (const [key, n] of fromSource)
        if (fromPages.get(key) !== n) throw new Error('Page/source index mismatch');
      template.checked = src;
    },
    /** Culling hierarchy, per-node bounds, group links and local box: the DAG's shape, shared
     *  by every instance of the object. */
    shapeOf(primitive: Primitive, template: Template): Shape {
      if (template.shape) return template.shape;
      if (!primitiveUsesClusterErrors(primitive))
        throw new EngineError(
          'STALE_CACHE',
          `Primitive ${primitive.mesh}/${primitive.primitive}: clusters without a DAG error band; recompile with ${DAG_ERROR_MODEL}`,
          { mesh: primitive.mesh, primitive: primitive.primitive, expected: DAG_ERROR_MODEL },
        );
      const culling = cullingNodes(primitive.culling, template.pages.length);
      const shape: Shape = {
        structure: structureIndex(primitive.structure, primitive.pages.length),
        culling,
        bounds: culling
          ? cullingBounds(
              culling,
              template.pages.map((entry) => entry.cut),
            )
          : undefined,
        links: culling ? cullingLinks(culling, template.pages.length) : undefined,
        local: localBox(primitive, culling),
      };
      template.shape = shape;
      return shape;
    },
  };
}
