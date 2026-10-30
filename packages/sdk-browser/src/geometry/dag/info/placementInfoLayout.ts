import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import {
  ALL_LIGHTING_CHANNELS_MASK,
  LIGHTING_CHANNEL_COUNT,
  storedLightingChannels,
} from '../../../../../sdk-core/src/contracts/lightingChannelsAbi.ts'

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
 * `switches` the object's offset switches (`PLACEMENT_EVALUATE`, `PLACEMENT_VELOCITY`, its marks and
 * lighting channels) and, from
 * `PLACEMENT_HLOD_SHIFT`, the HLOD index the placement draws as (`drawnAsHlod`); `wpoDisableSq`,
 * `wpoCentre` and `wpoMost` the words of the object's offset (`../../rows/page/offsetRow.ts`);
 * `outputs` the first of the placement's deformed results in the outputs' buffer (two words a page
 * of the placement, `NO_OUTPUTS` for a placement that deforms none of its pages); `infoShift` what
 * a page's index adds to reach its cluster record, `pageBase` the packed rank of the placement's
 * first page (`DagCutLinks.pageBase`); `customDepth` the object's custom depth word (`customDepthWord`,
 * `../../../../../sdk-core/src/contracts/customDepthAbi.ts`): its request, stencil value and write mask, which the custom depth's emission reads
 * through the `placement` of a drawn cluster. It sits in the padding of the record, which does not grow.
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
  ['customDepth', 'u32'],
] as const)

/** Words of a record, and its bytes. */
export const PLACEMENT_INFO_WORDS = PLACEMENT_INFO.words,
  PLACEMENT_INFO_BYTES = PLACEMENT_INFO.words * 4

/** The object evaluates its surfaces' offsets, and the offsets are a motion for the temporal pass
 *  (`RootOffsetRow.evaluate`, `.velocity`); the HLOD index the placement draws as lies above. */
export const PLACEMENT_EVALUATE = 1,
  PLACEMENT_VELOCITY = 2,
  /** The object is a first-person one: its pages carry the bit in `PageInfo.marks`. */
  PLACEMENT_FIRST_PERSON = 4,
  /** The object is held out of the image's alpha: its rows carry `FLAG_HOLDOUT`. */
  PLACEMENT_HOLDOUT = 8,
  /** The object lets the contact shadow rays through its pixels: its pages carry the bit in `PageInfo.marks`. */
  PLACEMENT_NO_CONTACT_SHADOW = 16
/** The object's lighting channels, three bits above the contact shadow's, stored (`storedChannelsOf`: zero is
 *  the default): its pages carry them in `PageInfo.marks`, the lights' per-pixel test reads them. */
export const PLACEMENT_CHANNELS_SHIFT = Math.log2(PLACEMENT_NO_CONTACT_SHADOW) + 1
/** The object casts an indirect capsule shadow (`Object3D.castCapsuleIndirectShadow`): its pages carry the bit in `PageInfo.marks`, above the channels. */
export const PLACEMENT_CAPSULE_INDIRECT_CASTER =
  1 << (PLACEMENT_CHANNELS_SHIFT + LIGHTING_CHANNEL_COUNT)
/** The HLOD index the placement draws as, from the bit above the capsule caster's. */
export const PLACEMENT_HLOD_SHIFT = PLACEMENT_CHANNELS_SHIFT + LIGHTING_CHANNEL_COUNT + 1
/** The bits of the placement's switches the lighting channels take. */
export const PLACEMENT_CHANNELS_MASK = ALL_LIGHTING_CHANNELS_MASK << PLACEMENT_CHANNELS_SHIFT
/** The lighting channels an object's bits hold, stored (`PLACEMENT_CHANNELS_MASK`; zero is the default). */
export const placementStoredChannelsOf = (objectBits: number) =>
  (objectBits & PLACEMENT_CHANNELS_MASK) >>> PLACEMENT_CHANNELS_SHIFT
/** The mask of the lighting channels an object's bits hold. */
export const placementChannelsOf = (objectBits: number) =>
  storedLightingChannels(placementStoredChannelsOf(objectBits))
/** The switches a placement's pages carry in `PageInfo.marks`, copied as they are. */
export const PLACEMENT_PAGE_MARKS =
  PLACEMENT_FIRST_PERSON |
  PLACEMENT_NO_CONTACT_SHADOW |
  PLACEMENT_CHANNELS_MASK |
  PLACEMENT_CAPSULE_INDIRECT_CASTER
/**
 * THE BITS OF AN OBJECT, one word a root (`RootOffsetRow.bits`, `objectBits`): what its node says that a placement, a page, a
 * blend item reads, in the placement's own bits, under the HLOD index (first person, holdout, no contact shadow, the channels).
 * What a view reads of an object (`Object3D.ownerNoSee`, `onlyOwnerSee`) sits above them in the same word (`OBJECT_VIEW_BITS`,
 * `../../rows/page/offsetRow.ts`), out of this mask: no placement carries it.
 */
export const PLACEMENT_OBJECT_BITS = PLACEMENT_PAGE_MARKS | PLACEMENT_HOLDOUT
/** `outputs` of a placement that deforms none of its pages. */
export const NO_OUTPUTS = 0xffffffff
