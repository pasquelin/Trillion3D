// Publication of a view drawn beside the main one (#1483): its readback ages the lists once, and
// republishing the same cut stirs nothing, since what is published is a difference.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { createWebgpuCutPublication } from './publication.ts'
import { fixturePages, fixtureUniforms } from './adopter.fixture.ts'
import type { CutDelta } from './delta.ts'
import type { WebgpuPagesCore } from '../pages/runtime.ts'
import type { WebgpuResidencySets } from '../residency/sets.ts'
import { createGroupClosure } from '../../page/cut/groupClosure.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'
import type { GpuCut } from '../../gpu/core/selection.ts'

/** A readback naming `asked` and drawing `drawn`, a new object each call. */
const readback = (asked: number[], drawn: number[]) =>
  ({
    uniforms: fixtureUniforms(),
    result: {
      pageIds: asked,
      drawablePageIds: drawn,
      frustumRejected: 0,
      lodLevel: 0,
      selectedTriangles: 0,
      drawnTriangles: 0,
      transparentTriangles: 0,
    },
    worldRevision: 0,
  }) as GpuCut

/** A view beside the main one is drawn, its readback `cut.now`; `capturing`: it is a capture. */
function banc(capturing = false) {
  const packedPages = fixturePages(4)
  for (let i = 0; i < packedPages.length; i++) {
    packedPages[i].min = [0, 0, 0]
    packedPages[i].max = [0, 0, 0]
  }
  // One placement of the four clusters, laid out as `../pages/prepare/layout.ts` lays it.
  const root = { pages: packedPages, world: new Matrix4() } as unknown as ClusterRoot<PageRec>
  const cut = { now: null as GpuCut | null }
  const shadowChanges: number[] = []
  let resourceChanges = 0
  const run = {
    desired: [] as unknown[],
    desiredPacked: [] as number[],
    shown: [] as unknown[],
    shownPacked: [] as number[],
    drawn: [] as unknown[],
    drawnPacked: [] as number[],
    selectionUniforms: fixtureUniforms(),
    gpuSelection: undefined,
    asideCut: { peek: () => cut.now },
    cutEpoch: 0,
    cutHeld: false,
    pagesEntered: null,
    pagesExited: null,
    gate: { resourcesChanged: () => resourceChanges++ },
  }
  /** What the residency sets actually received: differences, not lists. */
  const remue = { coupe: 0, dessinee: 0 }
  const compte = (delta: CutDelta) => delta.enteredCount + delta.exitedCount
  const residencySets = {
    applyCut: (delta: CutDelta) => (remue.coupe += compte(delta)),
    applyDrawn: (delta: CutDelta) => (remue.dessinee += compte(delta)),
    hostBytes: 0,
  } as unknown as WebgpuResidencySets
  const mainView = {},
    aside = {}
  const rt = {
    run,
    gpu: {},
    views: { main: mainView, active: aside, persistent: [] },
    capture: { capturing },
    lights: {
      store: { count: 1 },
      changes: { representationChanged: (min: number[]) => shadowChanges.push(min[0]) },
    },
    layout: {
      packedPages,
      recordOf: (packed: number) => packedPages[packed],
      gpuWanted: [packedPages[0]],
      selectionRoots: [root],
      placement: {
        baseOfRoot: Int32Array.from([0]),
        rootOfPacked: Int32Array.from(packedPages, () => 0),
      },
      rows: { watchTouched: () => {}, pageIndexOf: () => undefined },
    },
  } as unknown as WebgpuPagesCore
  /** The two lower tiers, and every list handed to the tier ahead. */
  const aheadOffers: number[][] = []
  const tiers = {
    shadow: { hostBytes: 0 },
    ahead: {
      hostBytes: 0,
      offerIds: (ids: ArrayLike<number>) => aheadOffers.push(Array.from(ids)),
    },
  }
  const publication = createWebgpuCutPublication(
    rt,
    residencySets,
    createGroupClosure(
      [],
      { baseOfRoot: new Int32Array(0), rootOfPacked: new Int32Array(0) },
      packedPages,
    ),
    { all: [tiers.shadow, tiers.ahead], ahead: tiers.ahead },
  )
  /** The view adopts `asked` and `drawn`, as its readback; the same object again for `same`. */
  const adopt = (asked: number[], drawn: number[], same = false) => {
    if (!same) cut.now = readback(asked, drawn)
    return publication.adoptViewCut()
  }
  return {
    publication,
    adopt,
    run,
    remue,
    shadowChanges,
    tiers,
    aheadOffers,
    resourceChanges: () => resourceChanges,
    residencySets,
    mainView,
  }
}

test('both lower tiers count in the host tables', () => {
  const { publication, tiers } = banc()
  const before = publication.hostTableBytes()
  assert.ok(Number.isFinite(before), `every table reads a size (${before})`)
  tiers.shadow.hostBytes = 64
  tiers.ahead.hostBytes = 32
  assert.equal(publication.hostTableBytes(), before + 96)
})

test('a view ages its lists once per readback, and publishes its cut', () => {
  const { adopt, run } = banc()
  const avant = run.cutEpoch
  assert.equal(adopt([0, 1, 2], [0, 1]), true)
  assert.equal(adopt([0, 1, 2], [0, 1], true), false, 'the same readback is adopted once')
  assert.equal(run.cutEpoch, avant + 1, 'a single ageing for the readback')
  assert.deepEqual(
    run.desired.map((page) => (page as { url: string }).url),
    ['p0', 'p1', 'p2'],
  )
  assert.deepEqual(run.drawnPacked, [0, 1], 'its drawn pages, rank by rank')
})

test('the camera cut moving stales no shadow page: the maps draw what the light cuts select', () => {
  const { adopt, shadowChanges, resourceChanges } = banc()
  adopt([0, 1, 2, 3], [0])
  adopt([0, 1, 2, 3], [1])
  adopt([0, 1, 2, 3], [0])
  assert.deepEqual(shadowChanges, [], 'no caster bound is declared for a camera cut change')
  assert.equal(resourceChanges(), 0, 'nor is the held frame woken for the shadows')
})

test('republishing the same cut stirs no set', () => {
  const { adopt, remue } = banc()
  adopt([0, 1, 2], [0, 1])
  const coupe = remue.coupe,
    dessinee = remue.dessinee
  assert.ok(coupe > 0 && dessinee > 0, 'the first publication did name pages')
  adopt([0, 1, 2], [0, 1])
  assert.equal(remue.coupe, coupe, 'the second neither enters nor exits a single page')
  assert.equal(remue.dessinee, dessinee)
})

test('a capture ranks its own wanted cut first: its packed ranks, at their count', () => {
  // The delta's buffer is swapped at each difference and longer than its live ranks (#1235).
  const { adopt, publication, run } = banc(true)
  adopt([0, 1, 2], [0])
  assert.deepEqual(run.desiredPacked, [0, 1, 2])
  adopt([3], [3])
  assert.deepEqual(run.desiredPacked, [3], 'the new cut, not a stale buffer')
  // Admission reads the capture's readback apart, first; the main view has adopted none yet.
  const { cuts, first } = publication.viewReadbacks()
  assert.deepEqual([cuts.length, first?.result.pageIds], [0, [3]])
})

test('an image that adopted nothing new hands the same readbacks out, nothing made', () => {
  const { adopt, publication } = banc(true)
  adopt([0, 1, 2], [0])
  const handed = publication.viewReadbacks()
  assert.equal(publication.viewReadbacks(), handed, 'the same object, its list untouched')
  adopt([3], [3])
  const next = publication.viewReadbacks()
  assert.deepEqual(next.first?.result.pageIds, [3], 'a new readback: made again')
})
