// The shipped march over depth images in an orthographic view, for its tests (`march.test.ts`,
// `marchFront.test.ts`).
import { reflectionRunner, viewOf } from './scene.fixture.ts'
import { depthField, depthImage } from './depthField.fixture.ts'

/** An orthographic view of `width × height` pixels whose world is its NDC: depth along +z, toward
 *  the eye. */
function flatView(width: number, height: number) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  return viewOf(identity, identity, [0, 0, 1, 0], [width, height])
}

/** The shipped march over the depth image `depth`, `width × height`, over the pyramid of the planes
 *  (`hizTrace` `'planes'`, which the march tests pin) or, `planes` false, over the closest depth of
 *  each centre the reference's walk reads, down to the full-resolution depth. */
export function marcher(
  width: number,
  height: number,
  depth: (x: number, y: number) => number,
  front: (x: number, y: number) => number = () => 0,
  planes = true,
) {
  const field = depthField(
    width,
    height,
    depthImage(width, height, depth),
    depthImage(width, height, front),
    planes,
  )
  const run = reflectionRunner(field, flatView(width, height))
  const size = [width, height]
  return {
    /** Where the ray from `o` along `d` stops on the screen, or undefined: a miss; the cells it
     *  read, and the iterations it may take. */
    hit(o: number[], d: number[]) {
      run.counter.loads = 0
      const end = run.screenMarchEnd(o.slice(0, 2), d.slice(0, 2), size)
      // The planes' march takes the thickness in pixels, the reference's walk a share of the depth.
      const {
        t,
        plane,
        front: transparent,
      } = run.screenMarch(
        o,
        d,
        end,
        run.thickness,
        run.relativeThickness,
        run.slab,
        2 ** 32 - 1,
        true,
      )
      const at = t < 0 ? undefined : o.map((x, k) => x + d[k] * t)
      return {
        at,
        depth: plane[0],
        transparent,
        loads: run.counter.loads,
        bound: run.screenMarchBudget(d, end, run.levels),
      }
    },
  }
}

/** The ray from the centre of pixel `(x0, y)` to the centre of `(x1, y)`, falling `fall` a pixel so
 *  that it passes through the depth `z` over the pixel `x`, at its centre. */
export const falling = (x0: number, x1: number, y: number, x: number, z: number, fall: number) => ({
  o: [x0 + 0.5, y + 0.5, z + fall * (x - x0)],
  d: [x1 - x0, 0, -fall * (x1 - x0)],
})
