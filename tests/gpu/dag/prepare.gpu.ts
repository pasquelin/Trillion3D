// What a cut reads of a placement it makes where it reads it, once per thread (`primitiveWgsl.ts`,
// `placed`): the cache changes no verdict. The kernel runs twice on the same cases: as shipped, and
// with every read made again from the pose on each call — `view · world`, the normal matrix and the
// conformity of the world's 3×3, each plane of either view —, each written on the engine's own
// accessors (`worldPose`, `invTranspose3Prep`, `isConformal`, `grownPlane`). Requests, drawn pages,
// counters and totals must be the same, bit for bit.
//
// Cases: the cone sample of defect 6 (tiny, singular, mirrored and non-uniform scales, where the
// normal matrix and the conformity flag decide), and pyramids under random rotations and scales —
// zero, negative, tiny, huge on an axis — seen by a still camera and by a moving one, whose view
// ahead reads planes and a `view · world` of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { DAG_SELECTION_SHADER } from '../../../packages/sdk-browser/src/gpu/dag/shader/shader.ts'
import {
  scenePages,
  sceneRoots,
} from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import {
  readCameraMotion,
  type CameraMotion,
} from '../../../packages/sdk-browser/src/camera/motion.ts'
import { random } from '../../../packages/sdk-browser/src/page/cut/cutRuleChecks.fixture.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { view, VIEWPORT, packCases } from '../math/inverseTransposeCases.ts'
import { ALL_CASES } from '../math/inverseTransposeSample.ts'
import { runSelectionKernel } from './selectionKernel.ts'

const POSE_3X3 = 'let m=worldPose(w);let n=mat3x3f(m[0].xyz,m[1].xyz,m[2].xyz);'
/** Each read as the engine ships it, and the expression its thread's cache keeps. */
const READS: Array<[string, string]> = [
  [
    'fn viewWorld(w:u32)->mat4x4f{',
    'fn viewWorld(w:u32)->mat4x4f{return views[select(0u,AHEAD_VIEW,vi==AHEAD_VIEW)].view*worldPose(w);}',
  ],
  [
    'fn normalOf(w:u32)->InvT3{',
    `fn normalOf(w:u32)->InvT3{${POSE_3X3}return invTranspose3Prep(n);}`,
  ],
  [
    'fn conformalOf(w:u32)->bool{',
    `fn conformalOf(w:u32)->bool{${POSE_3X3}return isConformal(n);}`,
  ],
  ['fn preparedPose(w:u32)->mat4x4f{', 'fn preparedPose(w:u32)->mat4x4f{return worldPose(w);}'],
  [
    'fn planeOf(w:u32,v:u32,i:u32)->vec4f{',
    `fn planeOf(w:u32,v:u32,i:u32)->vec4f{
 return select(grownPlane(transpose(worldPose(w))*views[v].planes[i],reachOf(w)),vec4f(0.0,0.0,0.0,1.0),unculledOf(w));
}`,
  ],
]

/** The shipped kernel with each read replaced, whole, by the expression its cache keeps: the
 *  function from its signature to its closing brace — none holds a block —, defined once. */
function recomputed() {
  return READS.reduce((text, [signature, expression]) => {
    const at = text.indexOf(signature)
    assert.ok(at >= 0 && text.indexOf(signature, at + 1) < 0, `${signature} is not defined once`)
    const stop = text.indexOf('}', at) + 1
    assert.ok(!text.slice(at + signature.length, stop).includes('{'), `${signature} holds a block`)
    return text.slice(0, at) + expression + text.slice(stop)
  }, DAG_SELECTION_SHADER)
}

/** Pyramids under random poses: each axis scale drawn among the edges or at random. */
function pyramidCases() {
  const next = random(979)
  const EDGES = [0, -1, 1e-7, 1e-3, 1, 7, 1e4]
  const scale = () => (next() < 0.5 ? EDGES[Math.floor(next() * EDGES.length)] : 0.2 + 3 * next())
  const world = (x: number) =>
    new G.Matrix4().compose(
      new G.Vector3(x, next() * 4 - 2, -next() * 6),
      new G.Quaternion().setFromEuler(new G.Euler(next() * 6.3, next() * 6.3, next() * 6.3)),
      new G.Vector3(scale(), scale(), scale()),
    )
  const pages = scenePages(512, 6)
  /** The camera at `x`, still, or moving along +x over the last tenth of a second. */
  function cameraAt(x: number, speed: number) {
    const camera = G.perspectiveCamera(55, 16 / 9, 0.1, 200)
    const at = (px: number) => {
      camera.position.set(px, 0, 12)
      camera.lookAt(px, 0, 0)
      camera.updateMatrixWorld(true)
      return engineCamera(camera)
    }
    if (!speed) return { eye: at(x), motion: undefined }
    const motion: CameraMotion = {}
    readCameraMotion(at(x - speed * 0.1), motion, 0)
    const eye = at(x)
    readCameraMotion(eye, motion, 100)
    return { eye, motion }
  }
  return Array.from({ length: 6 }, (_, n) => {
    const roots = sceneRoots(
      pages,
      Array.from({ length: 8 }, (_, w) => world(w * 5 - 17.5)),
      true,
    )
    const { eye, motion } = cameraAt(n * 3 - 7.5, n % 2 ? 40 : 0)
    const uniforms = cameraSelectionUniforms(eye, 1 + n, [1280, 720], undefined, motion)
    assert.equal(uniforms.ahead != null, n % 2 === 1, 'a moving camera sends its view ahead')
    return {
      name: `pyramids ${n}${motion ? ', moving' : ''}`,
      packed: packedWorldsToRenderOrigin(packDagSelection(roots), roots, uniforms.cameraWorld),
      uniforms,
    }
  })
}

test('the thread’s cached pose changes no request, drawn page, counter or total', async () => {
  const cones = {
    name: 'cones',
    packed: packCases(ALL_CASES),
    uniforms: cameraSelectionUniforms(view, 0, VIEWPORT),
  }
  const cases = [cones, ...pyramidCases()]
  const shipped = await runSelectionKernel(cases)
  const computed = await runSelectionKernel(cases, recomputed())
  // Requests of one priority come in the order threads appended them: compared as a set.
  const sorted = (reading: (typeof shipped.readings)[number]) => ({
    ...reading,
    requests: reading.requests.toSorted((a, b) => a - b),
    priorities: reading.priorities.toSorted((a, b) => a - b),
  })
  const rows = cases.map(({ name }, k) => {
    const [a, b] = [shipped.readings[k], computed.readings[k]]
    assert.deepEqual(sorted(a), sorted(b), `${name}: the cached pose changes the cut`)
    return { name, requests: a.requests.length, drawn: a.drawn.length, live: a.live }
  })
  console.log(JSON.stringify({ adapter: shipped.adapter, rows }))
  assert.ok(
    rows.every((row) => row.drawn > 0),
    'every case draws something',
  )
})
