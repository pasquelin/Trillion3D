// The layouts of the reflection trace's kernels (`traceLayouts`) hold every binding of group 0 the kernel's code reaches
// (a pipeline asks the layout for each one it uses), and the scene stage, which reads the surface cache, holds the layers a
// hit reads and no more.
import test from 'node:test'
import assert from 'node:assert/strict'
import { reachedBindings } from '../../bounce/reachedBindings.fixture.ts'
import { REFLECTION_TRACE_BINDINGS as B, traceLayouts } from './traceBindings.ts'
import { reflectionTraceShader } from './trace.ts'

/** A device that gives back the descriptor of each layout it is asked to make. */
const device = { createBindGroupLayout: (descriptor: object) => descriptor } as unknown as GPUDevice

/** The kernels' entries and the layout each is made over. */
const KERNELS = {
  classifyTiles: 'classify',
  traceScreen: 'screen',
  clearTracing: 'clearTracing',
  traceScene: 'scene',
  resolveSurface: 'resolve',
  temporalSurface: 'temporal',
  bilateralOpaque: 'bilateral',
  bilateralFront: 'bilateralFront',
  clearOpaque: 'clear',
  clearFront: 'clearFront',
} as const

/** The bindings of group 0 that `entry` reaches in `program`, by the variable's name. */
const reached = (program: string, entry: string) => reachedBindings(program, [entry])

for (const statistics of [false, true]) {
  test(`every kernel's layout holds the bindings its code reaches${statistics ? ', counting' : ''}`, () => {
    const program = reflectionTraceShader(statistics)
    const layouts = traceLayouts(device, statistics) as unknown as Record<
      string,
      { entries: { binding: number }[] }
    >
    for (const [entry, layout] of Object.entries(KERNELS)) {
      const held = new Set(layouts[layout].entries.map(({ binding }) => binding))
      for (const [binding, name] of reached(program, entry))
        assert.ok(held.has(binding), `${entry} reaches ${name} (${binding}), its layout holds none`)
    }
  })
}

test('the scene stage reads the cache’s depth, direct, indirect and final layers, the feedback and the tables, and no other layer', () => {
  const program = reflectionTraceShader(false)
  const names = [...reached(program, 'traceScene').values()]
  for (const name of [
    'surfaceTables',
    'scDepthAtlas',
    'scFinalAtlas',
    'scFeedback',
    'gdfObjectGrid',
  ])
    assert.ok(names.includes(name), name)
  // The library's layers beside those a hit reads, the albedo, normal and emission, are in no kernel's reach nor its layout.
  const reads = [B.cards, B.cards + 1, B.cards + 7, B.cards + 8]
  const layers = [...program.matchAll(/@group\(0\)\s*@binding\((\d+)\)\s*var\s+(sc\w+Atlas)/g)]
  assert.deepEqual(
    layers.filter(([, binding]) => !reads.includes(Number(binding))).map(([, , name]) => name),
    ['scAlbedoAtlas', 'scNormalAtlas', 'scEmissiveAtlas'],
  )
  for (const [, binding, name] of layers)
    assert.equal(names.includes(name), reads.includes(Number(binding)), name)
  const layout = traceLayouts(device, false).scene as unknown as { entries: { binding: number }[] }
  const held = layout.entries.map(({ binding }) => binding)
  assert.ok(
    reads.every((binding) => held.includes(binding)),
    'what a hit reads is bound',
  )
  assert.ok(![B.cards + 2, B.cards + 3, B.cards + 4].some((binding) => held.includes(binding)))
})
