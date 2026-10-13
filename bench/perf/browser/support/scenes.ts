// Bench inputs, realistic and hostile, from a seeded generator: two runs see the exact same floats.
import * as G from '../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { xorshiftRandom } from '../../../../packages/math/src/sequence/random.ts'

export function camera(z = 6, near = 0.1, aspect = 16 / 9) {
  const cam = G.perspectiveCamera(55, aspect, near, 200)
  cam.position.set(0, 0, z)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return cam
}

type Placed = { matrix: G.Matrix4; placementIndex: number }
const placed = (): Placed => ({ matrix: new G.Matrix4(), placementIndex: 0 })

/** A box only, without geometry: what Hi-Z projects and sorts. */
export interface SceneBox extends Placed {
  min: number[]
  max: number[]
  url: string
  array: Uint32Array
}

/** `[x0, y0, x1, y1, huge]`: a screen rectangle that `hizTestRect` must classify. */
export type SceneRect = [number, number, number, number, boolean]

/** Boxes only, what Hi-Z projects and sorts; `degenerees` adds the empty, inverted and infinite. */
export function boxes({
  count = 20000,
  seed = 11,
  degenerees = true,
}: { count?: number; seed?: number; degenerees?: boolean } = {}): SceneBox[] {
  const alea = xorshiftRandom(seed),
    list: SceneBox[] = []
  for (let i = 0; i < count; i++) {
    const cx = (alea() - 0.5) * 40,
      cy = (alea() - 0.5) * 24,
      cz = -alea() * 80
    const demi = 0.05 + alea() * 1.5
    let min = [cx - demi, cy - demi, cz - demi],
      max = [cx + demi, cy + demi, cz + demi]
    if (degenerees && i % 997 === 0) max = [...min]
    if (degenerees && i % 1499 === 0) {
      const echange = min
      min = max
      max = echange
    }
    if (degenerees && i % 2003 === 0) {
      min = [-Infinity, -Infinity, -Infinity]
      max = [Infinity, Infinity, Infinity]
    }
    if (degenerees && i % 311 === 0) {
      min = [cx - demi, cy - demi, -0.05]
      max = [cx + demi, cy + demi, 8]
    }
    list.push({
      min,
      max,
      ...placed(),
      url: `boite-${i}.bin`,
      array: new Uint32Array(3 * (1 + (i % 40))),
    })
  }
  return list
}

/** Screen rectangles that `hizTestRect` must classify: full screen, empty, off-field, huge. */
export function rectangles({
  count = 20000,
  seed = 13,
  width = 1280,
  height = 720,
}: { count?: number; seed?: number; width?: number; height?: number } = {}): SceneRect[] {
  const alea = xorshiftRandom(seed),
    list: SceneRect[] = []
  for (let i = 0; i < count; i++) {
    const x0 = Math.floor((alea() - 0.2) * width),
      y0 = Math.floor((alea() - 0.2) * height)
    const rectWidth = Math.floor(alea() ** 4 * width * 2),
      rectHeight = Math.floor(alea() ** 4 * height * 2)
    list.push([x0, y0, x0 + rectWidth, y0 + rectHeight, i % 173 === 0])
  }
  list.push([0, 0, width - 1, height - 1, false], [5, 5, 4, 4, false], [0, 0, 0, 0, false])
  list.push([-1000, -1000, -999, -999, false], [0, 0, 1 << 20, 1 << 20, false])
  return list
}
