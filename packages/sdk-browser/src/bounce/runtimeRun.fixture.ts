// The shipped WGSL of the run-time proxy's rays run as JavaScript (`shaderRun`) over a scene
// (`runtimeScene.fixture.ts`), and the helpers the tests along a line of sight and over a history share.
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { makeStore, reflectionViewOf, viewToEye, type Store } from './runtimeStore.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { runtimeAnswerWgsl } from './runtimeAnswerWgsl.ts'
import { TRACE_LIST, TRACE_LIST_FIRST } from './runtimeLayout.ts'
import type { world } from './runtimeScene.fixture.ts'
import type { Hit, Vec } from './runtimeOracle.fixture.ts'

/** The functions of the program the run reaches, each named: the interpreter follows the library's alone. */
const FUNCTIONS = [
  'rtBegin',
  'rtRadiance',
  'rtAnswer',
  'rtCast',
  'rtKeep',
  'rtHistory',
  'rtSurfaceHistory',
  'rtVirtualHistory',
  'rtPreviousCell',
  'rtHolds',
  'rtDepthOf',
  'rtDepthReach',
  'rtKeyDepth',
  'clipToFramebuffer',
  'perspectiveDivide',
  'ndcToPixel',
  'rtNone',
  'rtCellRead',
  'rtCellLayer',
  'rtReadSet',
  'rtWriteSet',
  'rtCellPut',
  'rtCellWrite',
  'rtHoleWrite',
  'rtCellAnswer',
  'rtOctEncode',
  'rtOctDecode',
  'rtPackShared',
  'rtUnpackShared',
  'rtStamp',
  'rtGroupAdd',
  'rtGroupSend',
  'rtSurfaceOf',
  'rtSurfaceVec',
  'rtShade',
  'rtScene',
  'rtEnter',
  'placementRay',
  'rtTraceCut',
  'rtSpent',
  'rtFloat',
  'rtVertex',
  'rtBox',
  'rtChild',
  'rtWorldOf',
  'rtWorldsLinear',
  'rtWorldsTranslation',
  'rtWorldsColumn',
  'rtWorldsMatrix',
  'rtWorldsOrigin',
  'rtWorldsInstance',
  'rtTreeNode',
  'rtTreeMembers',
  'rtTreeWord',
  'rtTreeMember',
  'rtTreeLow',
  'rtTreeHigh',
  'rtBlocked',
  'rtLit',
  'rtProbeRay',
]
const BINDINGS = { group: 0, proxy: 12, worlds: 13, tree: 14, list: 8, store: 9 }

/** Helpers the tests call: a ray's work, a pixel set, and a workgroup's counters shared then cleared. */
const HELPERS = `fn testWork()->u32{return rtWork+rtExtra;}
fn testTests()->u32{return rtTests;}
fn testReset(){rtWork=0u;rtTests=0u;}
fn testPixel(x:u32,y:u32,n:u32){rtPixel=vec2u(x,y);rtCalls=0u;rtRank=n;}
fn testLayer(layer:u32){rtLayer=layer;}
fn testShare(){rtGroupAdd();rtGroupSend();for(var k=0u;k<3u;k++){atomicStore(&rtGroup[k],0u);}rtSpentHere=0u;rtCastHere=false;rtLeftHere=false;}
`

/** The shipped program over `w`: the trace's list `list`, the frame's epoch or run-time words
 *  (`ReflectionView.runtime`: a bare epoch reads the store in place), the store. */
export function runOver(
  w: ReturnType<typeof world>,
  list: number[] = counters(0),
  runtime: number | readonly number[] = 2,
  store: Store = makeStore(),
) {
  const { header } = w
  const text = wgslModule(runtimeAnswerWgsl(BINDINGS)) + HELPERS
  return shaderRun<{
    rtScene: (o: Vec, d: Vec, limit: number) => Hit
    rtRadiance: (
      o: Vec,
      d: Vec,
      reach: number,
      tangent: number,
    ) => { color: Vec; confidence: number }
    rtAnswer: (
      P: Vec,
      N: Vec,
      o: Vec,
      d: Vec,
      reach: number,
      tangent: number,
    ) => { color: Vec; confidence: number }
    rtPackShared: (c: Vec) => number
    rtUnpackShared: (word: number) => Vec
    testWork: () => number
    testTests: () => number
    testReset: () => void
    testPixel: (x: number, y: number, rank: number) => void
    testShare: () => void
    testLayer: (layer: number) => void
  }>(
    text,
    [...FUNCTIONS, 'testWork', 'testTests', 'testReset', 'testPixel', 'testShare', 'testLayer'],
    {
      rtProxy: header,
      rtWorlds: w.worlds,
      rtTree: w.tree,
      rtWork: 0,
      rtTests: 0,
      rtExtra: 0,
      rtAnyHit: false,
      rtLost: false,
      rtPixel: [0, 0],
      rtCalls: 0,
      rtRank: 0,
      rtLayer: 0,
      rtSpentHere: 0,
      rtCastHere: false,
      rtLeftHere: false,
      rtGroup: [0, 0, 0],
      traceList: list,
      rtStore: store,
      rtFirst: 0,
      reflectionView: reflectionViewOf(runtime),
      viewToEye,
      // The lights are not this program's: a surface lit is its tint, the lighting a unit.
      surfaceLit: (tint: Vec) => tint,
      RtSurface: (tint: Vec, opacity: number, emission: Vec, blended: boolean) => ({
        tint,
        opacity,
        emission,
        blended,
      }),
      RtRadiance: (color: Vec, confidence: number) => ({ color, confidence }),
      RtCell: (
        color: number,
        share: number,
        stamp: number,
        normal: Vec,
        depth: number,
        distance: number,
      ) => ({ color, share, stamp, normal, depth, distance }),
      Box: (low: Vec, high: Vec) => ({ low, high }),
      ProxyChild: (box: unknown, offset: number, count: number, present: boolean) => ({
        box,
        offset,
        count,
        present,
      }),
      InvT3: (adj: unknown, scale: number, regular: boolean) => ({ adj, scale, regular }),
      PlacedRay: (origin: Vec, direction: Vec, regular: boolean) => ({
        origin,
        direction,
        regular,
      }),
      RtHit: (distance: number, placement: number, triangle: number, found: boolean) => ({
        distance,
        placement,
        triangle,
        found,
      }),
    },
  )
}

/** Cubes along a line of sight from the origin, `gap` apart, the first at `gap`. */
export const along = (count: number, gap: number) =>
  Array.from({ length: count }, (_, k) => {
    const m = new Matrix4()
    m.elements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, k * gap + gap, 0, 0, 1])
    return m
  })
export const ahead: Vec = [1, 0, 0]
export const origin: Vec = [0, 0, 0]

/** The trace's list of a frame that has spent `spent` of its work: the counters, no tile. */
export const counters = (spent: number) => {
  const words = new Array<number>(TRACE_LIST_FIRST).fill(0)
  words[TRACE_LIST.spent] = spent
  return words
}
