import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'

/**
 * WHAT A PLACEMENT ADDS TO THE CLUSTERS IT DRAWS, one record a placement (`PackedDag` world, the
 * `w` a visible cluster names): the words of a drawn cluster that no cluster decides
 * (`./clusterInfoLayout.ts` holds those). The host writes it when a placement is made, its
 * deformation's record moves, its object's offset switches change, the HLOD level it draws as
 * changes or its pages' deformed results are laid out again (`../../clusters/placementInfo.ts`); the
 * world itself is the root worlds' (`../../../placement/roots/rootWorlds.ts`), which the GPU holds
 * in doubles and the decode turns to single precision. The decode reads this and the cluster's
 * record and writes the drawn cluster's words (`../../../visibility/decode/decodeWgsl.ts`).
 *
 * `deform` is the float-pool record of the placement's deformation plus one (`PageInfo.deform`);
 * `switches` the object's offset switches (`PLACEMENT_EVALUATE`, `PLACEMENT_VELOCITY`) and, from
 * `PLACEMENT_HLOD_SHIFT`, the HLOD index the placement draws as (`drawnAsHlod`); `wpoDisableSq`,
 * `wpoCentre` and `wpoMost` the words of the object's offset (`../../rows/page/offsetRow.ts`);
 * `outputs` the first of the placement's deformed results in the outputs' buffer (two words a page
 * of the placement, `NO_OUTPUTS` for a placement that deforms none of its pages); `infoShift` what
 * a page's index adds to reach its cluster record, `pageBase` the packed rank of the placement's
 * first page (`DagCutLinks.pageBase`).
 */
export const PLACEMENT_INFO = fieldLayout('PlacementInfo', [
  ['deform', 'u32'],
  ['switches', 'u32'],
  ['wpoDisableSq', 'f32'],
  ['wpoMost', 'f32'],
  ['wpoCentre', 'vec3f'],
  ['outputs', 'u32'],
  ['infoShift', 'u32'],
  ['pageBase', 'u32'],
] as const)

/** Words of a record, and its bytes. */
export const PLACEMENT_INFO_WORDS = PLACEMENT_INFO.words,
  PLACEMENT_INFO_BYTES = PLACEMENT_INFO.words * 4

/** The object evaluates its surfaces' offsets, and the offsets are a motion for the temporal pass
 *  (`RootOffsetRow.evaluate`, `.velocity`); the HLOD index the placement draws as lies above. */
export const PLACEMENT_EVALUATE = 1,
  PLACEMENT_VELOCITY = 2,
  /** The object is a first-person one: its pages carry `PageInfo.firstPerson`. */
  PLACEMENT_FIRST_PERSON = 4,
  /** The object is held out of the image's alpha: its rows carry `FLAG_HOLDOUT`. */
  PLACEMENT_HOLDOUT = 8,
  PLACEMENT_HLOD_SHIFT = 8
/** `outputs` of a placement that deforms none of its pages. */
export const NO_OUTPUTS = 0xffffffff
