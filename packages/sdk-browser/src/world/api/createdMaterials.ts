/** The materials a page creates (#847): what it may name, the surface built from it, and that
 *  surface in each geometry variant a drawable asks of it (`materialApi.ts`). */
import type { GraphSurface } from '../../host/graph/surface.ts';
import { hostPageSurface } from '../../host/pageObjects.ts';
import { surfaceVariantOf, variantKey } from '../../host/prepared/materials.ts';
import { alphaModeOf, type AlphaMode } from '../../../../sdk-core/src/contracts/material.ts';
import { firstMaterial } from '../../scene/materialSide.ts';
import type { HostGraphMesh } from '../../host/scene/graphNodes.ts';
import { EngineError } from '../../../../sdk-core/src/index.ts';
import {
  invalid,
  MASK_CUTOFF,
  PATCH_FIELDS,
  validate,
  type SceneMaterialPatch,
} from './materialValues.ts';

/** What `createMaterial` takes: a patch's values but tiling, a name, and a map — refused until
 *  the texture atlas takes one after open (#847). */
export type CreatedMaterial = Omit<SceneMaterialPatch, 'tiling'> & {
  name?: string;
  map?: ImageBitmap;
};

/** Most materials a page creates in one session (`createMaterial`), refused above by name before
 *  anything is built (`MATERIAL_CEILING`). */
export const RUNTIME_MATERIAL_CEILING = 256;

/** What `createMaterial` takes, anything else refused by name: a change's values but tiling,
 *  and a name. */
const CREATED_FIELDS = [...PATCH_FIELDS.filter((field) => field !== 'tiling'), 'name'];

/** Every value the page named for a created material, checked as a change's are, or a named
 *  refusal before anything is built: a map is not taken yet (steps (b), (c) of #847). */
export function validateCreated(id: string, props: CreatedMaterial) {
  if (props.map !== undefined)
    throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'a created material takes no map yet', {
      id,
    });
  validate(id, props, CREATED_FIELDS);
  if (props.name !== undefined && typeof props.name !== 'string')
    throw invalid(id, 'name', props.name);
}

/** A created material's surfaces by variant (`variantKey`), the plain one under this key. */
export const PLAIN = variantKey({ vertexColors: false, flatShading: false });

/** A created material's surface in the variant `attributes` ask for, cloned from its plain one
 *  the first time. */
function variantOf(variants: Map<string, GraphSurface>, attributes: Record<string, unknown>) {
  const variant = surfaceVariantOf(attributes),
    key = variantKey(variant);
  let surface = variants.get(key);
  if (!surface) variants.set(key, (surface = Object.assign(variants.get(PLAIN)!.clone(), variant)));
  return surface;
}

/** Created material `variants` given to the meshes `drawn`: each wears the variant its geometry
 *  asks for, as the open gave it its own; the meshes may wear surfaces of several classes, and
 *  `from` is one that moves across blended if any does. */
export function assignment(variants: Map<string, GraphSurface>, drawn: ReadonlySet<HostGraphMesh>) {
  const meshes = new Map<HostGraphMesh, GraphSurface>(),
    modes: AlphaMode[] = [];
  for (const mesh of drawn) {
    meshes.set(mesh, variantOf(variants, mesh.geometry.attributes));
    modes.push(alphaModeOf(firstMaterial(mesh.material)!));
  }
  const to = alphaModeOf(variants.get(PLAIN)!);
  const from = modes.find((mode) => (mode === 'blend') !== (to === 'blend')) ?? modes[0];
  return { surfaces: [...new Set(meshes.values())], meshes, from, to };
}

/** A created material where the page names nothing: glTF's material defaults, metal 1 among
 *  them (a host surface's own default, `metalRough`, is 0). */
const CREATED_DEFAULTS = {
  baseColor: [1, 1, 1],
  opacity: 1,
  metalness: 1,
  roughness: 1,
  emissive: [0, 0, 0],
  side: 'front',
  alphaMode: 'opaque',
  alphaCutoff: MASK_CUTOFF,
} as const;

/** The host surface of a created material: what the page named, glTF's default elsewhere, drawn
 *  as a repainted primitive is (`hostPageSurface`). */
export function createdSurface({ name, ...props }: CreatedMaterial) {
  // A value named `undefined` is one the page did not name: glTF's default, not a hole; a map
  // is refused before (`validateCreated`), so none reaches here.
  const named = Object.entries(props).filter(([, value]) => value !== undefined);
  const surface = hostPageSurface(
    { ...CREATED_DEFAULTS, ...Object.fromEntries(named) },
    false,
  ) as unknown as GraphSurface;
  if (name) surface.name = name;
  return surface;
}
