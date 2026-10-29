// #1521: a source added to a world's scene while its session runs — another material on the geometry
// the session already draws, or another geometry — joins the session in place (`append/webgpuAppend.ts`):
// the session is not opened again, and its image is the image of a world opened on both within one 8-bit
// step per channel (`ONE_STEP`, whose rounding `appendCases.ts` explains).
import { appendCases, ONE_STEP } from './appendCases.ts'

appendCases(
  'appendInPlacePage.ts',
  'appendInPlace',
  [
    ['a second material on a held geometry', 'run'],
    ['a second geometry', 'runGeometry'],
  ],
  ONE_STEP,
)
