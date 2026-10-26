// The noise node of the material graph (`graphNodes.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { COLOR_SAMPLE_WGSL } from '../virtual/wgsl.ts'
import { compileGraph } from './compile.ts'
import { body, type Graph } from './graphBody.fixture.ts'

const compileFor = (g: Graph) =>
  compileGraph(g, { sample: COLOR_SAMPLE_WGSL, derivatives: 'neighbours' })

test('a noise reads the world position repeated every 65536, calls its function by number with its properties as literals, and brings its block only where it is called', () => {
  const call = body((g) => g.noise())
  assert.match(call, /let v0:vec3f=\(65536\.0\*fract\(ctx\.world\/65536\.0\)\);/)
  assert.match(
    call,
    /mgNoise\(v0,1\.00000000,1i,0i,true,6i,-1\.00000000,1\.00000000,2\.00000000,0\.00000000,false,512\.000000\)/,
  )
  const wired = body((g) =>
    g.noise({
      position: g.appendVector(g.texCoord(0), g.constant(0)),
      noiseFunction: 'voronoi',
      quality: 4,
      levels: 99,
      turbulence: false,
      tiling: true,
      repeatSize: 8,
      filterWidth: 0.25,
    }),
  )
  assert.match(
    wired,
    /mgNoise\(v0,1\.00000000,4i,5i,false,10i,/,
    'five is voronoi, ten levels at most',
  )
  assert.match(wired, /0\.250000000,true,8\.00000000\)/)
  assert.match(
    body((g) => g.noise({ levels: 0 })),
    /,0i,true,1i,/,
    'one level at least',
  )
  const names = [
    'simplex',
    'gradient',
    'fastGradient',
    'gradientAlu',
    'valueAlu',
    'voronoi',
  ] as const
  names.forEach((noiseFunction, at) =>
    assert.match(
      body((g) => g.noise({ noiseFunction })),
      new RegExp(`1i,${at}i,true,6i`),
    ),
  )
  const sum = material.graph('surface')
  sum.output('emissive', sum.noise({ position: sum.constant(1, 2, 3) }))
  const plain = material.graph('surface')
  plain.output('emissive', plain.constant(1))
  const text = (g: Graph) =>
    wgslModule(compileGraph(g, { sample: COLOR_SAMPLE_WGSL, derivatives: 'neighbours' }).wgsl)
  assert.match(text(sum), /fn mgNoise\(position:vec3f/)
  assert.doesNotMatch(text(plain), /mgNoise/)
  // The directions of the two tables: twelve edges of a cube, the middle of the map's a byte of 136.
  const [maps, volume] = [
    /mgNoiseMapEdges:array<vec3f,12>=array<vec3f,12>\(([^;]*)\);/,
    /mgNoiseVolumeEdges:array<vec3f,12>=array<vec3f,12>\(([^;]*)\);/,
  ].map(
    (t) =>
      text(sum)
        .match(t)![1]
        .match(/vec3f\(/g)!.length,
  )
  assert.deepEqual([maps, volume], [12, 12])
  assert.match(text(sum), /vec3f\(0\.0666667223,1\.00000000,1\.00000000\)/)
  assert.match(text(sum), /vec3f\(0\.00000000,1\.00000000,1\.00000000\)/)
  // The steps of the stream's table, composed by the set bits of n, reach the n-th value of the stream.
  const step = (name: string) =>
    [
      ...text(sum)
        .match(new RegExp(`${name}:array<u32,15>=array<u32,15>\\(([^)]*)\\)`))![1]
        .matchAll(/\d+/g),
    ].map(Number)
  const [mul, add] = [step('mgNoiseStepMul'), step('mgNoiseStepAdd')]
  let stream = 12345
  for (let n = 1; n <= 4096; n++) {
    stream = (Math.imul(stream, 196314165) + 907633515) >>> 0
    let [a, c] = [1, 0]
    for (let i = 0; n >>> i !== 0; i++)
      if ((n >>> i) & 1)
        [a, c] = [Math.imul(mul[i], a) >>> 0, (Math.imul(mul[i], c) + add[i]) >>> 0]
    assert.equal((Math.imul(a, 12345) + c) >>> 0, stream, `value ${n} of the stream`)
  }
  assert.match(
    body((g) =>
      g.noise({ position: g.appendVector(g.texCoord(0), g.constant(0)), relativeToCamera: true }),
    ),
    /\(v0 \+ ctx\.eye\)/,
    'a camera-relative position is moved by the camera',
  )
  // A graph that names a function the node has not is refused.
  const bad = material.graph('surface')
  bad.output('emissive', bad.addNode('noise', { noiseFunction: 'perlin' }))
  assert.throws(() => compileFor(bad), /noise has no function 'perlin'/)
  const light = material.graph('lightFunction')
  light.output('emissive', light.noise())
  assert.throws(() => compileFor(light), /worldPosition has no value in the lightFunction domain/)
})
