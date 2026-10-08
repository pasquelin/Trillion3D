// Generated cuts for the occlusion split and test: boxes spread through the view, and the screen
// bounds the engine gives them.
import * as G from '../host/graph/graph.fixture.ts'
import type { HizPage } from './types.ts'
import { splitOccludersInto } from './split.fixture.ts'
import { cameraAt, projectBoxToScreen } from '../../../../tests/fixtures/hiz.ts'
import { engineCamera } from '../camera/camera.fixture.ts'
import { identityRoots } from '../page/selection/placements.fixture.ts'

export type Tagged = HizPage & { tag: number; array?: ArrayLike<number> }

export const box = (min: number[], max: number[], tag: number, triangles = 0): Tagged => ({
  min,
  max,
  tag,
  array: new Uint32Array(triangles * 3),
})

/** A box of the generated cut: somewhere in the view, from far behind the origin to near the eye. */
export function randomBox(rand: () => number, tag: number) {
  const x = (rand() - 0.5) * 6,
    y = (rand() - 0.5) * 6,
    z = -8 + rand() * 12
  const sx = 0.05 + rand() * 1.5,
    sy = 0.05 + rand() * 1.5,
    sz = rand() * 1.5
  return box([x - sx, y - sy, z - sz], [x + sx, y + sy, z + sz], tag, 1 + Math.floor(rand() * 40))
}

export function split(
  pages: Tagged[],
  cam = engineCamera(cameraAt()),
  viewport: [number, number] = [64, 64],
) {
  const occluders: Tagged[] = [],
    rest: Tagged[] = []
  const count = splitOccludersInto(pages, identityRoots(), cam, viewport, occluders, rest)
  return { occluders, rest, count }
}

export const bounds = (page: Tagged, cam = cameraAt(), viewport: [number, number] = [64, 64]) =>
  projectBoxToScreen(page.min, page.max, new G.Matrix4(), cam, viewport)
