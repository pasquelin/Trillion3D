// #1521: blended and transmissive geometries added to a world's scene while its session runs join
// the session in place (`placement/webgpuAppend.ts`, `webgpu/blend/growth.ts`): the session is not
// opened again, and its settled image is the image of a world opened on all of them within ONE 8-bit
// step per channel, no pixel farther. Not bit for bit: the reflections read the previous lit image
// (`reflections/radiance.ts`), so the image a session settles on is the fixed point of a feedback —
// the lit image reflected into the next one. The session that joins content starts that series from
// the image it held, the fresh open from its first; both converge to the same reflected image, and
// what is left between them is the second-order feedback of the lit image into the next
// reflections — the reflectance times the history's 1/12 share (`REFLECTION_HISTORY`) of a
// difference itself under a step: it may tip a channel's 8-bit rounding, never by a whole step more.
// One step is that rounding; a pixel farther is a defect of the join. The proofs whose path has no
// such feedback keep the bit-for-bit comparison (`appendCases` without a step).
import { appendCases } from './appendCases.ts'

/** The largest 8-bit step a channel of the joined session's image lies from the fresh open's. */
const ONE_STEP = 1

appendCases(
  'appendBlendPage.ts',
  'appendBlend',
  [
    ['a blended geometry the session does not hold', 'runBlended'],
    ['a transmissive geometry the session does not hold', 'runTransmissive'],
    ['a blended and a transmissive geometry, and a second material', 'runBoth'],
    ['a blended geometry in a session that draws none', 'runBlendedFirst'],
    ['a transmissive geometry in a session opened without water', 'runTransmissiveFirst'],
    ['a transmissive geometry in a session that draws nothing transparent', 'runTransmissiveAlone'],
    ['an emitting surface in a session none of whose surfaces emits', 'runEmissive'],
    ['a textured surface in a session that wears no texture', 'runTextured'],
    ['more blended meshes of a batch than its rows hold', 'runBlendedRows'],
    ['more transmissive meshes of a batch than its rows hold', 'runTransmissiveRows'],
    ['more blended and transmissive meshes than their rows hold', 'runBothRows'],
  ],
  ONE_STEP,
)
