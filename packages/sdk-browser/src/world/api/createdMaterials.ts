/** The materials a page creates (#847): what it may name, and the surface built from it
 *  (`materialApi.ts`). */
import type { GraphSurface } from '../../host/graph/surface.ts';
import { hostPageSurface } from '../../host/pageObjects.ts';
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
export function createdSurface({ name, map: _, ...props }: CreatedMaterial) {
  // A value named `undefined` is one the page did not name: glTF's default, not a hole.
  const named = Object.entries(props).filter(([, value]) => value !== undefined);
  const surface = hostPageSurface(
    { ...CREATED_DEFAULTS, ...Object.fromEntries(named) },
    false,
  ) as unknown as GraphSurface;
  if (name) surface.name = name;
  return surface;
}
