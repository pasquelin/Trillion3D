// The blending modes a scene declares are compiled off the frame, at prepare: the first draw in such a mode finds its pipeline and compiles nothing. What is compiled is
// what the draw would have compiled itself, descriptor for descriptor: the image cannot change.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../geometry/pages/surface.ts'
import { BLEND_MODES } from '../materials/surface/materialBlending.ts'
import { declaredBlendVariants, pipelinesByVariant } from './stagePipelines.ts'
import { variantOfBlend } from './plan/planCull.ts'
import { blendGraphsAnimated, graphProgramsOf } from './graphWgsl.ts'
import { blendShader } from './shader.ts'
import { transmitWgsl } from './transmission/transmitWgsl.ts'
import { FACING_SHIFT } from './facing.ts'
import { isProgram, programOf, type GraphSurface } from '../materials/graph/surfaceProgram.ts'
import { material } from '../../../sdk-core/src/world/material/index.ts'
import type { MaterialGraph } from '../../../sdk-core/src/world/material/graph/api.ts'
import type { BlendGpuItem } from './state.ts'
import type { Blending } from '../../../sdk-core/src/world/constants/index.ts'

/** Blend items as prepare leaves them, one per blending mode. */
function items(blendings: Blending[], transmissive: boolean[] = []) {
  return blendings.map((blending, index) => {
    const surface = G.basicSurface()
    Object.assign(surface, { blending })
    return { surface: surfaceOf(surface), transmissive: !!transmissive[index] }
  }) as unknown as BlendGpuItem[]
}

test('the declared variants are the modes the non-transmissive items name in their lighting, and normal forward for a transmissive one', () => {
  assert.deepEqual(declaredBlendVariants([]), [], 'no transparent item, no blend program')
  // The simple surfaces here are unlit: each mode is declared in the unlit lighting program, in rank.
  const all = items([...BLEND_MODES].reverse())
  assert.deepEqual(
    declaredBlendVariants(all),
    BLEND_MODES.map((mode) => variantOfBlend(mode, 'unlit')),
  )
  const glass = items(['additive', 'multiply'], [true, false])
  assert.deepEqual(
    declaredBlendVariants(glass),
    [variantOfBlend('normal', 'forward'), variantOfBlend('multiply', 'unlit')],
    'transmission blends normal',
  )
})

test('a precompiled variant is drawn without a compile; a variant a draw asked first is compiled once', async () => {
  const built: string[] = []
  // A device that names how each pipeline was compiled: at once by a draw, or off the frame.
  const device = {
    createRenderPipeline: ({ label }: GPURenderPipelineDescriptor) => (
      built.push(`now:${label}`),
      { label, now: true }
    ),
    createRenderPipelineAsync: async ({ label }: GPURenderPipelineDescriptor) => (
      built.push(`async:${label}`),
      { label, now: false }
    ),
  } as unknown as GPUDevice
  const set = pipelinesByVariant(device, (variant) => [
    { label: `v${variant}` } as GPURenderPipelineDescriptor,
  ])
  const now = (variant: number) => (set.at(variant, 0) as unknown as { now: boolean }).now
  assert.equal(set.at(9, 0), undefined, 'a draw compiles nothing on the frame: skipped meanwhile')
  await set.precompile([0, 4, 9])
  assert.deepEqual(built, ['async:v9', 'async:v0', 'async:v4'])
  assert.equal(now(9), false, 'the variant a draw asked is the one found, not made again')
  assert.equal(now(4), false)
  assert.equal(now(0), false)
  assert.equal(built.length, 3, 'no draw compiles a precompiled variant')
  await set.precompile([4])
  assert.equal(built.length, 3, 'a compiled variant is never compiled again')
})

test('the blend modules hold the programs of the graphs the translucent items wear, once each', () => {
  const wearing = (graph: MaterialGraph, transparent: boolean) => {
    const surface = G.basicSurface()
    Object.assign(surface, { transparent, graph })
    return { surface: surfaceOf(surface) }
  }
  const tinted = (r: number) => {
    const graph = material.graph('surface')
    graph.output('emissive', graph.constant(r, 0, 0))
    return graph
  }
  const shared = tinted(1)
  // Two surfaces whose graphs compile alike are one program; a graph an opaque surface wears is
  // the resolve's, never the transparent pass's.
  const found = graphProgramsOf([
    wearing(shared, true),
    wearing(tinted(1), true),
    wearing(tinted(0.5), true),
    wearing(tinted(0.25), false),
    { surface: surfaceOf(G.basicSurface()) },
  ])
  assert.equal(found.length, 2)
  assert.ok(found.every((program) => program.kind === 'blend'))
  assert.deepEqual(
    found.map((program) => program.id),
    [...new Set(found.map((program) => program.id))].sort((a, b) => a - b),
  )
  assert.deepEqual(graphProgramsOf(items(['normal'])), [], 'a scene with no graph holds none')
})

/** The blend module of a translucent surface that wears a graph wiring `wire`, over `surface`, with
 *  the transmissive stages where `transmits`. */
function blendText(
  wire: (g: MaterialGraph) => void,
  surface: Omit<GraphSurface, 'graph'> = {},
  { transmits = false, lobeless = false } = {},
) {
  const graph = material.graph('surface')
  wire(graph)
  const program = programOf({ graph, transparent: true, ...surface })
  assert.ok(isProgram(program), 'the graph compiles')
  const stage = transmits ? transmitWgsl({ lobeless }, false, [program]) : undefined
  return blendShader({ lobeless }, { graphs: [program], stage })
}

test('a translucent graph finds its values by the rank of its item, whatever facing mode rides above it', () => {
  const text = blendText((g) => g.output('baseColor', g.constant(1, 0, 0)))
  const mask = Number(
    /fn materialGraphOf\(word:u32\)->u32\{return materialTableRecord\(word&(\d+)u,/.exec(text)![1],
  )
  // The vertex stage puts the cull mode (1 front, 2 back) in the bits above the rank (`FACING_SHIFT`):
  // the rank is what is left under the mask, the whole of it.
  for (const rank of [0, 1, 255, 70000])
    for (const mode of [0, 1, 2])
      assert.equal(
        ((rank | (mode << FACING_SHIFT)) & mask) >>> 0,
        rank,
        `rank ${rank} mode ${mode}`,
      )
})

test('the lobes of a translucent graph are its own, set before the item is lit; a lobeless module has none', () => {
  const wire = (g: MaterialGraph) => {
    g.output('clearCoat', g.constant(0.6))
    g.output('anisotropy', g.constant(-0.4))
  }
  const lobed = blendText(wire)
  assert.match(
    lobed,
    /fn blendGraphLobes\(g:BlendGraph\)\{\s*if\(physicalOn&&g\.law!=0u\)\{physicalRecord\.lobes=g\.lobes;physicalRecord\.maps=array<u32,7>\(\);physicalRecord\.law=g\.law;physicalTangent=g\.tangent;\}/,
  )
  assert.match(lobed, /out\.lobes=vec4f\(abs\(mgA\),0\.0,saturate\(mgClearCoat_\w+\(ctx,g\)\),/)
  assert.ok(lobed.indexOf('blendPhysicalBegin(in,g);\n blendGraphLobes(g.graph);') > 0)
  assert.doesNotMatch(blendText(wire, {}, { lobeless: true }), /blendGraphLobes|out\.lobes/)
  assert.doesNotMatch(blendShader({}), /blendGraphLobes/)
})

test('a translucent graph that wires a refraction gives its fragments’ ior; one that does not leaves the material’s', () => {
  const wired = blendText(
    (g) => g.output('refraction', g.constant(1.33)),
    { transmission: 1 },
    { transmits: true },
  )
  assert.match(wired, /out\.refraction=mgRefraction_\w+\(ctx,g\);out\.flags\|=4u;/)
  assert.match(
    wired,
    /fn transmitInvIor\(in:VSOut,g:BlendGrads\)->f32\{\s*if\(\(g\.graph\.flags&4u\)!=0u&&g\.graph\.refraction!=0\.0\)\{return 1\.0\/g\.graph\.refraction;\}\s*return materialAt\(/,
  )
  assert.match(wired, /let invIor=transmitInvIor\(in,g\);\s*if\(invIor==1\.0\)/)
  const plain = blendShader({}, { stage: transmitWgsl({}, false) })
  assert.match(plain, /fn transmitInvIor\(in:VSOut,g:BlendGrads\)->f32\{\s*return materialAt\(/)
  assert.doesNotMatch(plain, /graph\.refraction/)
})

test('a graph that wires the thin translucent outputs gives its layer the colour and coverage, and the depth its pixels move to', () => {
  const text = blendText(
    (g) => {
      g.output('baseColor', g.constant(1, 0, 0))
      g.output('transmittanceColor', g.constant(0.2, 0.5, 0.9))
      g.output('surfaceCoverage', g.constant(0.8))
      g.output('pixelDepthOffset', g.constant(0.5))
    },
    { transmission: 1 },
    { transmits: true },
  )
  assert.match(
    text,
    /out\.layer=clamp\(mgTransmittanceColor_\w+\(ctx,g\),vec3f\(0\.0\),vec3f\(1\.0\)\);out\.coverage=clamp\(mgSurfaceCoverage_\w+\(ctx,g\),0\.0,1\.0\);out\.flags\|=16u;/,
  )
  assert.match(text, /out\.depth=mgPixelDepthOffset_\w+\(ctx,g\);out\.flags\|=32u;/)
  assert.match(
    text,
    /if\(\(k\.g\.graph\.flags&16u\)!=0u\)\{top=clamp\(s\.alpha,0\.0,1\.0\);tint=k\.g\.graph\.layer;coverage=k\.g\.graph\.coverage;\}/,
  )
  // The responsiveness pass writes the depth the offset moves the pixel to; a module with no offset writes none.
  assert.match(text, /struct MarkedDepth\{[^}]*@builtin\(frag_depth\) depth:f32,\}/)
  assert.doesNotMatch(text, /struct Covered\{[^}]*frag_depth/)
  assert.doesNotMatch(
    blendText(
      (g) => g.output('baseColor', g.constant(1, 0, 0)),
      { transmission: 1 },
      { transmits: true },
    ),
    /frag_depth|graph\.layer/,
  )
})

test('a translucent graph’s specular sets the pixel’s reflectance before its lights, its unlit one shows its emission', () => {
  const lit = blendText((g) => g.output('specular', g.constant(0.9)))
  assert.match(lit, /out\.specular=saturate\(mgSpecular_\w+\(ctx,g\)\);/)
  assert.match(
    lit,
    /surfaceSpecular=s\.specular;\s*if\(physicalOn&&blendLobeValues\.specular>=0\.0\)\{surfaceSpecular=blendLobeValues\.specular;\}\s*blendLobes\(/,
  )
  assert.match(lit, /forwardIndirect\(rgb,m,indirectF0\(rgb,m\),/)
  assert.match(lit, /select\(0\.5,g\.graph\.specular,g\.graph\.id!=0u\)/)
  assert.doesNotMatch(blendShader({}), /\bs\.specular|surfaceSpecular=s\./)
  const wire = (g: MaterialGraph) => {
    g.output('baseColor', g.constant(1, 0, 0))
    g.output('emissive', g.constant(0, 0, 1))
  }
  const unlit = blendText(wire, { lit: false })
  assert.match(unlit, /out\.rgb=max\(mgEmissive_\w+\(ctx,g\),vec3f\(0\.0\)\);\s*out\.opacity/)
  assert.match(unlit, /out\.emissive=vec3f\(0\.0\);/)
  assert.doesNotMatch(unlit, /mgBaseColor/)
  assert.match(
    blendText(wire, { allowNegativeEmissive: true }),
    /out\.emissive=mgEmissive_\w+\(ctx,g\);/,
  )
})

test('the transparent pass is drawn every image where a program of its graphs reads the time', () => {
  const time = material.graph('surface')
  time.output('opacity', time.sine(time.time(), 2))
  const still = material.graph('surface')
  still.output('opacity', still.constant(0.5))
  const ids = (graph: MaterialGraph) => {
    const program = programOf({ graph, transparent: true })
    assert.ok(isProgram(program))
    return [program.id]
  }
  assert.equal(blendGraphsAnimated(ids(time)), true)
  assert.equal(blendGraphsAnimated(ids(still)), false)
  assert.equal(blendGraphsAnimated(undefined), false)
})
