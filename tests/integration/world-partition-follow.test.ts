// #404: the synthetic worlds of `world-partition.test.ts`, compiled by this checkout's native
// compiler and read whole as a world reads them (`loadModel`), their cells followed by the
// session's per-frame step (`world-partition-follow.fixture.ts`): a zoom out to 0.5 and a parent
// scaled down leave no object missing, the rows grown in place, no session reopened.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Object3D } from '../../packages/sdk-core/src/world/object/object3d.ts'
import { loadModel } from '../../packages/sdk-browser/src/world/core/loadedModel.ts'
import { createWorldPoses } from '../../packages/sdk-browser/src/world/core/worldPoses.ts'
import { compiled, compiler, machine, SPACING, world } from './world-partition.fixture.ts'
import { assertNoneMissing, followed } from './world-partition-follow.fixture.ts'

const skip = !existsSync(compiler)

/** `gltf` compiled under a folder of its own, served and read whole. */
async function served(t: TestContext, gltf: ReturnType<typeof world>) {
  const root = await mkdtemp(join(tmpdir(), 'world-partition-follow-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pointer = await compiled(root, gltf)
  machine(t, pointer)
  return loadModel(pointer.href, { textureSource: 'host', scope: 'full' })
}

test(
  '#404: a zoom out to 0.5 leaves no object missing, and no session is reopened',
  { skip },
  async (t) => {
    const model = await served(t, world(96))
    const view = await followed(model, [48 * SPACING, 2, 48 * SPACING])
    const before = await view.settle()
    const near = await assertNoneMissing(view)
    view.camera.zoom = 0.5
    const after = await view.settle()
    const wider = await assertNoneMissing(view)
    t.diagnostic(JSON.stringify({ before, after, near, wider, ...view.engine.counts }))
    assert.ok(wider > near && after.held > before.held, 'the wider view holds more cells')
    assert.deepEqual([after.waiting, view.renewed.count], [0, 0])
  },
)

test(
  '#404: a parent scaled down leaves no object missing, and no session is reopened',
  { skip },
  async (t) => {
    const model = await served(t, world(384, 'district'))
    const view = await followed(model, [48 * SPACING, 2, 48 * SPACING])
    const before = await view.settle()
    const scene = new Object3D()
    scene.add(model)
    const district = model.getObjectByName('district')!
    district.scale.set(0.25, 0.25, 0.25)
    const poses = createWorldPoses()
    poses.moved(district)
    poses.apply(scene, new Map(), new Map(), () => {})
    const after = await view.settle()
    const near = await assertNoneMissing(view, 0.25)
    t.diagnostic(JSON.stringify({ before, after, near, ...view.engine.counts }))
    assert.ok(view.engine.counts.grown > 0 && after.held > before.held, 'rows grown in place')
    assert.deepEqual([after.waiting, view.renewed.count], [0, 0])
  },
)
