// Absolute Hi-Z measurement: the rectangle occlusion test, the CPU twin of the WGSL one
// (`packages/sdk-browser/src/gpu/hiz/rectWgsl.ts`). No oracle here: it has no prior implementation
// to confront; its correctness is held by `packages/sdk-browser/src/hiz/occlusion.test.ts`, and
// the line says so rather than staying silent. `visibilityDepth` left this bench: only tests call it.
import { hizTestRect } from '../../../packages/sdk-browser/src/hiz/occlusion.ts'
import { measure, stress, rapport } from '../../core/index.ts'
import { rectangles, type SceneRect } from './support/scenes.ts'

const rects = rectangles({ count: 20000 })
const scratch = new Int32Array(5)
/** The verdict and the five levels/texels of each rectangle, written in a buffer kept per size. */
const outputs = new Map<number, Int32Array>()
const testAll = (list: SceneRect[]) => {
  let output = outputs.get(list.length)
  if (!output) outputs.set(list.length, (output = new Int32Array(list.length * 6)))
  for (let i = 0; i < list.length; i++) {
    const [x0, y0, x1, y1, clipsNear] = list[i]
    output[i * 6] = hizTestRect(x0, y0, x1, y1, clipsNear, 1280, 720, 12, scratch) ? 1 : 0
    for (let v = 0; v < 5; v++) output[i * 6 + 1 + v] = scratch[v]
  }
  return output
}

const hizResult = await measure({
  name: 'hizTestRect',
  fichier: 'packages/sdk-browser/src/hiz/occlusion.ts',
  cas: [
    { name: '20k rects 12 levels', input: rects, size: rects.length },
    { name: 'no rectangles', input: [], size: 0 },
  ],
  calculation: testAll,
  motif: 'time only — correctness in packages/sdk-browser/src/hiz/occlusion.test.ts',
  options: { tours: 200, budgetMs: 1000 },
})

await stress({
  name: 'hizTestRect extremes',
  calculation: (e) => hizTestRect(e.x0, e.y0, e.x1, e.y1, e.clip, 1280, 720, 12, scratch),
  extremes: [
    { name: 'empty rect', input: { x0: 5, y0: 5, x1: 4, y1: 4, clip: false } },
    { name: 'huge rect', input: { x0: 0, y0: 0, x1: 1 << 20, y1: 1 << 20, clip: false } },
    { name: 'negative rect', input: { x0: -1000, y0: -1000, x1: -999, y1: -999, clip: false } },
    { name: 'zero rect', input: { x0: 0, y0: 0, x1: 0, y1: 0, clip: true } },
  ],
})

rapport('hiz-rectangles', [hizResult], 'Hi-Z: rectangle occlusion — absolute measurement')
