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

/**
 * Ce qu'un objet source porte une fois, quel que soit le nombre de fois qu'on le pose dans la
 * scène : bandes d'erreur, paquets de streaming, identités de clusters, hiérarchie de culling et
 * ses bornes, liens de groupes, boîte locale. Rien là-dedans ne dépend de la matrice monde d'un
 * placement — deux instances d'un même objet en tenaient jusqu'ici deux copies. Les placements
 * gardent ce qui leur appartient : une matrice, un rang de dessin, un maillage.
 *
 * L'ordre des vérifications est celui d'avant, placement par placement : page absente, couverture
 * des indices, puis bande d'erreur du cache. Seul leur nombre change.
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
  local: Float64Array;
};

/** Multiensemble des triangles d'un tableau d'indices : la couverture est une identité de
 *  multiensemble, jamais une identité d'ordre — le DAG réordonne les triangles. */
function triangleCounts(arr: ArrayLike<number>) {
  const map = new Map<string, number>();
  for (let i = 0; i < arr.length; i += 3) {
    const key = `${arr[i]},${arr[i + 1]},${arr[i + 2]}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** La boîte locale d'une primitive : celle de la racine de sa hiérarchie, ou l'union de ses pages. */
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

/** Les gabarits des primitives d'une scène : chacun calculé au premier placement, relu ensuite. */
export function createPrimitiveTemplates(indices: Map<string, Uint32Array>, allowMissing: boolean) {
  const held = new Map<Primitive, Template>();
  return {
    /** Les pages d'une primitive : tableau d'indices, bande d'erreur, paquet, identité. */
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
        // Le rang source d'un cluster ne dépend que de la primitive ; seul un maillage transparent
        // le lit, et il le lit à l'identique sous chacune de ses instances.
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
    /** La couverture, vérifiée une fois par couple primitive / indices source : deux placements
     *  d'un même objet posent la même géométrie, donc le même tableau d'indices. */
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
    /** Hiérarchie de culling, bornes par nœud, liens de groupes et boîte locale : la forme du DAG,
     *  partagée par toutes les instances de l'objet. */
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
        local: localBox(primitive, culling),
      };
      template.shape = shape;
      return shape;
    },
  };
}
