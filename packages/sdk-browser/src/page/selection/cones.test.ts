// The cone a page is culled by is computed once, at collection (`collectRecords.ts`): the one the
// compiler cooked on a front-only surface, an open one on a surface seen from its back. No root
// declares its cones any more: the cut reads `cone` on every page it keeps.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { collectClusterPages } from './selection.ts'
import { selectVisiblePages } from '../cut/cut.fixture.ts'
import { blendFixture, camera } from './blend.fixture.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { OPEN_CONE, type NormalCone } from '../cone/cone.ts'

/** A cone that looks opposite the camera: honoured, it rejects its page; open, the page stays. */
const COOKED: NormalCone = { axis: [0, 0, -1], angle: 0 }

/** What `read` finds of the fixture wearing `material`, its nearest page cooked with `COOKED`. */
function collectedWith<T>(
  material: G.GraphSurface,
  read: (collected: ReturnType<typeof collectClusterPages>) => T,
) {
  const fixture = blendFixture(material)
  ;(fixture.metadata.primitives[0].pages[0] as { cone?: NormalCone }).cone = COOKED
  const found = read(
    collectClusterPages(fixture.source, fixture.metadata, fixture.indices, fixture.associations),
  )
  fixture.geometry.dispose()
  fixture.material.dispose()
  return found
}

const cones = (material: G.GraphSurface) =>
  collectedWith(material, ({ allPages }) => allPages.map((page) => page.cone))
const shown = (material: G.GraphSurface) =>
  collectedWith(material, ({ roots }) =>
    selectVisiblePages(roots, engineCamera(camera()), {}).shown.map((page) => page.url),
  )

test('collection keeps the cooked cone of a front-only surface and opens it on its back', () => {
  const [near, far] = cones(G.basicSurface({ side: G.FRONT_SIDE }))
  assert.equal(near, COOKED)
  assert.equal(far, undefined, 'a page cooked with no cone keeps none')
  for (const side of [G.DOUBLE_SIDE, G.BACK_SIDE])
    assert.equal(cones(G.basicSurface({ side }))[0], OPEN_CONE)
})

test('the cut rejects a page by the cone collection gave it, no root declaring it', () => {
  assert.ok(!shown(G.basicSurface({ side: G.FRONT_SIDE })).includes('near'))
  assert.ok(shown(G.basicSurface({ side: G.DOUBLE_SIDE })).includes('near'))
})
