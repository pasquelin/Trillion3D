import {
  BOX_VALUES,
  DAG_ERROR_MODEL,
  EngineError,
  boxEmpty,
  boxUnion,
  primitiveUsesClusterErrors,
  type Primitive,
} from '../../../../sdk-core/src/index.ts';
import {
  clusterErrorFields,
  cullingNodes,
  quantizationErrorOf,
  streamPlacement,
} from './helpers.ts';
import { structureIndex } from './structure.ts';
import { cullingBounds } from '../cut/bounds.ts';
import { cullingLinks, type CullingLinks } from '../cut/forced.ts';

/**
 * What a source object carries once, however many times it is placed in the scene: error bands,
 * streaming bundles, cluster identities, the culling hierarchy and its bounds, group links, local
 * box. None of that depends on a placement's world matrix — two instances of the same object used
 * to hold two copies of it. Placements keep what belongs to them: a matrix, a draw rank, a mesh.
 *
 * The checks are the previous ones, once per primitive instead of once per placement: missing
 * page, index coverage, then the cache's error band.
 *
 * COVERAGE IS CHECKED AGAINST THE CACHE'S OWN RECORD (#288). Until this batch the pages of a primitive
 * were concatenated and their triangles compared, as a multiset, with those of the source
 * geometry the host had loaded — the engine path holding the source indices only for that. What
 * a page is checked against now is what the manifest declares of it: the index count of the page
 * entry. The page/source identity itself is a property of the cook, proved where it is produced
 * (`packages/asset-compiler-rust`, its golden fixtures) and not re-derived at every load by a
 * runtime that will soon have no source file to derive it from (#78, part 4c).
 */
type Template = {
  pages: Array<{
    array: Uint32Array | undefined;
    cut: ReturnType<typeof clusterErrorFields>;
    placed: { url: string; offset: number } | undefined;
    clusterId: string;
  }>;
  sourceOrder: number[];
  complete: boolean;
  shape: Shape | undefined;
};
type Shape = {
  structure: ReturnType<typeof structureIndex>;
  culling: ReturnType<typeof cullingNodes>;
  bounds: Float64Array | undefined;
  links: CullingLinks | undefined;
  local: Float64Array;
};

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
      const quantizationError = quantizationErrorOf(primitive);
      const pages = primitive.pages.map((page, index) => {
        const array = indices.get(page.url);
        if (!array && !allowMissing && indices.size) throw new Error('Missing page');
        // The page carries the indices its manifest entry declares, or the cache is not the one
        // this manifest describes: a short page would draw a hole and a long one another page's
        // triangles, both silently.
        if (array && array.length !== page.count) throw new Error('Incomplete cluster coverage');
        return {
          array,
          cut: clusterErrorFields(page, quantizationError),
          placed: placement?.[index],
          clusterId: `${primitive.mesh}/${primitive.primitive}/${page.id}`,
        };
      });
      const template: Template = {
        pages,
        // The source rank of a cluster depends only on the primitive; only a transparent mesh
        // reads it, and it reads it identically under each of its instances.
        sourceOrder: primitive.pages.map((page, index) => page.start ?? index),
        complete: primitive.pages.every(
          (page) => indices.has(page.url) || (page.role ?? 'exact') === 'coarse',
        ),
        shape: undefined,
      };
      held.set(primitive, template);
      return template;
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
      const quantizationError = quantizationErrorOf(primitive);
      const culling = cullingNodes(primitive.culling, template.pages.length, quantizationError);
      const shape: Shape = {
        structure: structureIndex(primitive.structure, primitive.pages.length, quantizationError),
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
