// #1521: blended and transmissive geometries added to a world's scene while its session runs join
// the session in place (`placement/webgpuAppend.ts`, `webgpu/blend/growth.ts`): the session is not
// opened again, and its image is pixel for pixel the image of a world opened on all of them.
import { appendCases } from './appendCases.ts'

appendCases('appendBlendPage.ts', 'appendBlend', [
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
])
