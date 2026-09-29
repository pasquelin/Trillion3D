/** The materials a page creates (#847): what it may name, the surface built from it, and that
 *  surface in each geometry variant a drawable asks of it (`materialApi.ts`). */
import type { GraphSurface } from '../../host/graph/surface.ts';
import { hostPageSurface } from '../../host/pageObjects.ts';
import { surfaceVariantOf, variantKey } from '../../host/prepared/materials.ts';
import { alphaModeOf, type AlphaMode } from '../../../../sdk-core/src/contracts/material.ts';
import { firstMaterial } from '../../scene/materialSide.ts';
import type { HostMesh } from '../../host/resources.ts';
import {
  invalid,
  MASK_CUTOFF,
  PATCH_FIELDS,
  validate,
  type SceneMaterialPatch,
} from './materialValues.ts';

/** Values of a runtime material; a map admission returns a promise. */
export type CreatedMaterial = Omit<SceneMaterialPatch, 'tiling'> & {
  /** Page label for the new material. */
  name?: string;
  /** Caller-owned bitmap, decoded without premultiplication or colour conversion. Keep open until drop. */
  map?: ImageBitmap;
};

/** Most materials a page creates in one session (`createMaterial`), refused above by name before
 *  anything is built (`MATERIAL_CEILING`). */
export const RUNTIME_MATERIAL_CEILING = 256;

/** What `createMaterial` takes, anything else refused by name: a change's values but tiling,
 *  and a name. */
const CREATED_FIELDS = [...PATCH_FIELDS.filter((field) => field !== 'tiling'), 'name', 'map'];

/** Every value the page named for a created material, checked as a change's are, or a named
 *  refusal before anything is built. */
export function validateCreated(id: string, props: CreatedMaterial) {
  if (
    props.map !== undefined &&
    (typeof ImageBitmap === 'undefined' || !(props.map instanceof ImageBitmap))
  )
    throw invalid(id, 'map', props.map);
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
  if (!surface) {
    surface = Object.assign(variants.get(PLAIN)!.clone(), variant, { needsUpdate: true });
    variants.set(key, surface);
  }
  return surface;
}

/** Created material `variants` given to the meshes `drawn`: each wears the variant its geometry
 *  asks for, as the open gave it its own; the meshes may wear surfaces of several classes, and
 *  `from` is one that moves across blended if any does. */
export function assignment(variants: Map<string, GraphSurface>, drawn: ReadonlySet<HostMesh>) {
  const meshes = new Map<HostMesh, GraphSurface>(),
    to = alphaModeOf(variants.get(PLAIN)!);
  let from: AlphaMode | undefined;
  for (const mesh of drawn) {
    meshes.set(mesh, variantOf(variants, mesh.geometry.attributes));
    const mode = alphaModeOf(firstMaterial(mesh.material)!);
    if (from === undefined || (mode === 'blend') !== (to === 'blend')) from = mode;
  }
  return { surfaces: [...new Set(meshes.values())], meshes, from: from!, to };
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
export function createdSurface({ name, map: _map, ...props }: CreatedMaterial) {
  // Maps are admitted separately; undefined values keep the glTF defaults.
  const named = Object.entries(props).filter(([, value]) => value !== undefined);
  const surface = hostPageSurface(
    { ...CREATED_DEFAULTS, ...Object.fromEntries(named) },
    false,
  ) as unknown as GraphSurface;
  if (name) surface.name = name;
  return surface;
}
