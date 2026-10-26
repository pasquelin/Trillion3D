// The offset hook of the shipped visibility raster, run in JavaScript over the offset programs of
// graphs a test builds (`wpoHook.test.ts`).
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { visShader } from './visWgsl.ts'
import { WPO_ROW_MOVES } from '../types.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { wpoProgramOf } from '../../materials/graph/wpoProgram.ts'
import { graphRastersOf } from '../../materials/graph/graphRasters.ts'
import { visibilityWpo } from './wpoSets.ts'

const IDENTITY = new Mat([...IDENTITY_MATRIX4])

/** A surface that slides by the time along x, and by the second coordinate of its UV along y. */
function slidingProgram() {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  const along = g.multiply(g.time(), g.constant(1, 0, 0))
  const up = g.multiply(g.componentMask(g.texCoord(0), 'g'), g.constant(0, 1, 0))
  g.output('worldPositionOffset', g.add(along, up))
  const program = wpoProgramOf({ graph: g })
  assert.ok(program, 'the offset compiles')
  return { program, g }
}

/** A surface whose offset along y is the world x of its vertex. */
export function followingProgram() {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  g.output(
    'worldPositionOffset',
    g.multiply(g.componentMask(g.worldPosition(), 'r'), g.constant(0, 1, 0)),
  )
  const program = wpoProgramOf({ graph: g })
  assert.ok(program, 'the offset compiles')
  held.set(program.key, g)
  return program
}

/** What the hook reads of the image: the clocks (time, real time, then before), the camera and the
 *  camera before. */
export interface World {
  time?: number
  before?: { time: number; eye: number[] }
  eye?: number[]
}
const frameOf = ({ time = 3, before, eye = [0, 0, 0] }: World = {}) => ({
  clock: [time, 0, before?.time ?? time, 0],
  eye: [...eye, 1],
  before: [...(before?.eye ?? eye), 0],
})

/** The row of a vertex of the object: its offset word, the square of its disable distance, the centre
 *  of its bounds and the greatest offset. */
export interface Row {
  wpo?: number
  stops?: number
  centre?: number[]
  most?: number
}

/** The offset hook of the shipped raster over the surface of `program`, its row's world scaled by
 *  `scale`, run in JavaScript: the offset in the primitive's space of the vertex at UV `uv`. The
 *  shadow pass sets `threshold`, its map's (`wpoThreshold`). */
export function offsetAt(
  program: { key: number },
  row: Row = {},
  world: World = {},
  {
    scale = 1,
    previous = false,
    uv = [0, 0.25],
    local = [0, 0, 0],
    threshold = -1,
    still = IDENTITY,
    header = [program.key, 0, 0, 0],
  } = {},
) {
  const source = `${visShader({ wpo: visibilityWpo(graphRastersOf([{ graph: held.get(program.key) }])) })}
fn probe(page:PageInfo,h:ClusterHeader,local:vec3f,previous:bool,before:mat4x4f,t:f32)->vec3f{
 wpoThreshold=t;return pageWpoLocal(page,h,0u,local,previous,before);
}`
  const run = shaderRun<{ probe: (...args: unknown[]) => number[] }>(source, ['probe'], {
    materialGraphWord: () => 1,
    materialTableRecord: (record: number, texel: number) =>
      record === 0 && texel === 0 ? header : [0, 0, 0, 0],
    pageHasUvSet: () => false,
    pageUv: () => uv,
    wpoSurfaceHeader: (_page: unknown, h: object) => h,
    graphFrame: frameOf(world),
  })
  const { wpo = WPO_ROW_MOVES, stops = 0, centre = [0, 0, 0], most = 0 } = row
  const scaled = new Mat([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1])
  return run.probe(
    {
      world: scaled,
      material: 0,
      wpo,
      wpoDisableSq: stops * stops,
      wpoCentre: centre,
      wpoMost: most,
    },
    {},
    local,
    previous,
    still,
    threshold,
  )
}

/** The graph each program key was made from, so that a test makes its session's rasters from it. */
export const held = new Map<number, ReturnType<typeof material.graph>>()
export const slides = () => {
  const { program, g } = slidingProgram()
  held.set(program.key, g)
  return program
}
