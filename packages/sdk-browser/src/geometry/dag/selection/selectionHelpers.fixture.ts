import { readCameraWorld, type HostCamera } from '../../../camera/world.ts'
import { createEngineCamera } from '../../../camera/engineCamera.ts'
import { collectClusterPages } from '../../selection/collect.ts'
import { selectVisiblePages } from '../../cut/cut.fixture.ts'
import { cameraSelectionUniforms } from '../../../gpu/core/selection.ts'
import assert from 'node:assert/strict'
import { createGpuDagSelection } from './selection.ts'
import { packDagSelection } from '../pack/pack.ts'
import { dagFixture, wideCamera } from '../../selection/dag.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { ruleResidency } from '../readiness.fixture.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import { evaluateDagSelectionKernel } from '../oracle/oracle.fixture.ts'
import { packedWorldsToRenderOrigin } from '../pack/pack.fixture.ts'
import { graphDraws } from '../../selection/drawSource.ts'
import { hostStretches } from '../hostStretches.fixture.ts'

const VIEWPORT: [number, number] = [1280, 720]
export function packed(fixture: ReturnType<typeof dagFixture>) {
  const { roots } = collectClusterPages(
    fixture.source,
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
  )
  return { roots, dag: packDagSelection(roots) }
}

const helperCam = createEngineCamera()

/**
 * The kernel uniforms AND the render frame where its world matrices are set: the two are
 * never built one without the other, no more here than in the engine, where each cut reads a
 * translation at the eye of its uniforms (`../shader/worldPoseWgsl.ts`). A setup that only set
 * the uniforms would leave absolute world matrices under a view with no translation: two
 * frames in the same formula, and a wrong cut with nothing to say so.
 */
export function kernelUniforms(
  dag: ReturnType<typeof packDagSelection>,
  roots: Parameters<typeof packDagSelection>[0],
  camera: HostCamera,
  pixelError: number,
  viewport: [number, number] = VIEWPORT,
) {
  const cam = readCameraWorld(helperCam, camera)
  packedWorldsToRenderOrigin(dag, roots, cam.eye)
  return cameraSelectionUniforms(cam, pixelError, viewport)
}

/** The urls of the pages the kernel's oracle draws for `fixture` (`../oracle/oracle.fixture.ts`),
 *  every page resident unless `resident` says otherwise: what a CPU cut selects. */
export function kernelUrls(
  fixture: ReturnType<typeof dagFixture>,
  pixelError: number,
  camera: HostCamera,
  resident?: Uint32Array,
) {
  const { dag, roots } = packed(fixture)
  const result = evaluateDagSelectionKernel(
    dag,
    kernelUniforms(dag, roots, camera, pixelError),
    resident && ruleResidency(dag, resident),
  )
  return { result, urls: (result.drawablePageIds ?? []).map((id) => dag.pageUrlOf(id)).sort() }
}

export function cpuUrls(
  fixture: ReturnType<typeof dagFixture>,
  pixelError: number,
  camera: HostCamera,
) {
  const { roots } = collectClusterPages(
    fixture.source,
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
  )
  return selectVisiblePages(roots, readCameraWorld(helperCam, camera), {
    pixelError,
    viewport: VIEWPORT,
  })
    .shown.map((page) => page.url)
    .sort()
}

/** The wide-camera DAG on a device whose readbacks wait for `release`: a snapshot held in flight. */
export function gatedDag() {
  installGpuGlobals()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0)
  const { device, destroyedMaps } = mockDagDevice(dag, { mapping: gate })
  return { release, fixture, dag, uniforms, device, destroyedMaps }
}

/** A selection on the fixture under a wide camera, not cut yet. */
export async function fixtureSelection() {
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0)
  const selection = await createGpuDagSelection(mockDagDevice(dag).device, dag, {
    roots: hostStretches(dag),
  })
  assert.ok(selection)
  return { fixture, dag, uniforms, selection }
}

/** A selection on the fixture, cut once under a wide camera: its requests in hand, every page of the
 *  seven its kept leaves hold — nothing resident, no leaf's floor prunes it. */
export async function cutOnce() {
  const { fixture, dag, uniforms, selection } = await fixtureSelection()
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 7)
  return { fixture, dag, uniforms, selection }
}
