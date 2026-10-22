import type { TessellationField } from '../contracts/tessellationOptions.ts'

/** What each setting of the tessellation means (`../contracts/tessellationOptions.ts`): a material
 *  names a displacement map and switches its tessellation on in its glTF `extras`
 *  (`displacement`, `../contracts/materialAbi.ts`). */
export const TESSELLATION_MEANINGS: Readonly<Record<TessellationField, string>> = {
  tessellation:
    'Whether a material that names a displacement and switches its tessellation on is cut into micro-triangles and displaced along its normals each frame; true by default. Off, every such material draws as the flat surface its triangles describe and nothing of the tessellation runs. A scene whose materials name no displacement pays nothing either way.',
  tessellationDicingRate:
    'The size, in pixels, of the micro-triangles a displaced triangle is diced to, above 0; 2 by default. A smaller size cuts finer, follows the height map more closely and costs more.',
  tessellationMaxPatchesPerGroup:
    'The patches one group of the dicing pass takes at most, a whole number of at least 1; 5 by default, held to what a group holds at three threads a patch.',
  tessellationMaxCandidatePatches:
    'The patches the splitting queue holds at most for an image, a whole number from 1; 2 097 152 by default. A patch past it is lost for that image.',
  tessellationMaxVisiblePatches:
    'The patches the visible list holds at most for an image, a whole number from 1; 2 097 152 by default. A patch past it is lost for that image.',
}
