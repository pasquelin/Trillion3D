// #1521: blended and transmissive geometries added to a world's scene while its session runs join
// the session in place (`append/webgpuAppend.ts`, `src/blend/growth.ts`): the session is not
// opened again, and its settled image is the image of a world opened on all of them within ONE 8-bit
// step per channel, no pixel farther (`ONE_STEP`, whose rounding `appendCases.ts` explains).
import { appendCases, ONE_STEP } from './appendCases.ts'

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
