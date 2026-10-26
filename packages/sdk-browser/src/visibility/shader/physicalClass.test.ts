// The anisotropic and clear-coat lobes are a resolve class of their own (`physicalWgsl.ts`): only a
// lit row whose surface carries a lobe compiles their record, maps and target, and the resolve
// reads them where the frame and the request need them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { materialClassKey } from './materialClass.ts'
import { CLASS_FEATURE } from './classWords.ts'
import { FLAG_LIT } from '../types.ts'
import { SHADE_SHADER, shadeShader } from './shadeWgsl.ts'
import { PHYSICAL_LOBES_CALL, PHYSICAL_RESOLVE_WGSL, physicalUvRead } from './physicalWgsl.ts'
import { SHADE_REQUEST_WGSL } from './request.ts'
import { PHYSICAL_MAP_FIELDS } from '../materialType.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { COTANGENT_FRAME_WGSL } from '../../geometry/cluster/cotangentFrameWgsl.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture as WorldTexture } from '../../../../sdk-core/src/world/texture/texture.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import { isProgram, programOf, type GraphSurface } from '../../materials/graph/surfaceProgram.ts'

/** `physicalUvRead` with no graph's sets. */
const PHYSICAL_UV_READ = physicalUvRead()

const noMaps = { rough: 0, metal: 0, ao: 0, emissive: 0, normal: 0 }

test('a lit row with a lobe is of the physical class, no other row is', () => {
  const { HAS_PHYSICAL } = CLASS_FEATURE
  assert.equal(materialClassKey(FLAG_LIT, { ...noMaps, physical: true }), HAS_PHYSICAL)
  assert.equal(materialClassKey(0, { ...noMaps, physical: true }), 0)
  assert.equal(materialClassKey(FLAG_LIT, noMaps), 0)
})

test('the resolve reads the record before its request and the lobes once its normal is final', () => {
  const fragment = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shadeSurface'))
  const record = fragment.indexOf(PHYSICAL_UV_READ),
    lobes = fragment.indexOf(PHYSICAL_LOBES_CALL)
  assert.ok(record > 0 && record < fragment.indexOf('let request=shadeRequest('))
  // The base normal map bends the normal in its last block (the first one reads its sample).
  const bend = fragment.lastIndexOf('if(HAS_NORMAL_MAP){')
  assert.ok(lobes > bend)
  assert.ok(lobes < fragment.indexOf('return SurfaceOut(vec4f(rgb,metal)'))
  // The coat bends its own map from the normal before the base normal map.
  assert.ok(fragment.indexOf('let coatBase=N;') < bend)
  // The lobe word is read in the physical class alone, and the lobes run where it names an extension.
  assert.ok(PHYSICAL_UV_READ.includes('if(HAS_PHYSICAL){lobes=materialLobesOf(page.material);}'))
  assert.ok(PHYSICAL_LOBES_CALL.startsWith('if(HAS_PHYSICAL&&physicalOn'))
  // Its maps ask their tiles after the others.
  assert.ok(
    wgslSource(SHADE_REQUEST_WGSL).includes(`+select(0u,${PHYSICAL_MAP_FIELDS.length}u,physical);`),
  )
  assert.match(
    wgslSource(SHADE_REQUEST_WGSL),
    /return physicalRequest\(p,missing,p\.sel-physicalFirst\);/,
  )
})

/** The resolve's text of a surface that wears a graph wiring `wire`, over what `surface` says of it. */
function graphText(wire: (g: MaterialGraph) => void, surface: Omit<GraphSurface, 'graph'> = {}) {
  const graph = material.graph('surface')
  wire(graph)
  const program = programOf({ graph, ...surface })
  assert.ok(isProgram(program), 'the graph compiles')
  return shadeShader({ graph: program.compiled })
}

test('a graph gives a lobe only where it wires it: the anisotropy alone has no coat, the coat alone no stretch', () => {
  const aniso = graphText((g) => g.output('anisotropy', g.constant(0.6)))
  assert.match(aniso, /physicalRecord\.lobes=vec4f\(abs\(mgA\),0\.0,0\.0,0\.0\);/)
  assert.doesNotMatch(aniso, /mgClearCoat/)
  const coat = graphText((g) => g.output('clearCoat', g.constant(0.5)))
  assert.match(coat, /let mgA=0\.0;/)
  assert.match(coat, /physicalRecord\.lobes=vec4f\(abs\(mgA\),0\.0,saturate\(mgClearCoat\(/)
  assert.match(coat, /physicalTangent=vec3f\(1\.0,0\.0,0\.0\);/)
})

test('the tangent of a graph’s anisotropy is carried whole to the world and kept orthogonal to the final normal', () => {
  const run = shaderRun<{ physicalValues: (...args: unknown[]) => Record<string, unknown> }>(
    wgslBlock('physicalProbe', [PHYSICAL_RESOLVE_WGSL, COTANGENT_FRAME_WGSL], ''),
    ['physicalValues'],
    {
      physicalRecord: {
        lobes: [0.5, 0, 0, 0],
        coatNormalScale: [1, 1],
        channels: 0,
        law: 1,
        sheen: [0, 0, 0, 0],
        maps: [0, 0, 0, 0, 0, 0, 0],
      },
      physicalTangent: [1, 0, 1],
      physicalCoords: [],
      uni: { clearCoatNormal: 1 },
      ROUGHNESS_FLOOR: 0.045,
    },
  )
  // The frame T = x, B = y over the vertex normal z; the final normal leans to (0, 0.6, 0.8): the
  // tangent (1, 0, 1) is x + z in the world, less its share along the normal.
  const frame = { T: [1, 0, 0], B: [0, 1, 0] }
  const values = run.physicalValues(
    [0, 0.6, 0.8],
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
    1,
    1,
    frame,
    true,
  )
  const expected = [1, -0.48, 0.36].map((x) => x / Math.sqrt(1.36))
  ;(values.direction as number[]).forEach((x, i) => assert.ok(Math.abs(x - expected[i]!) < 1e-6))
})

test('a surface that is not lit shows its emission and nothing else; a material may allow it to be negative', () => {
  const wire = (g: MaterialGraph) => {
    g.output('baseColor', g.constant(1, 0, 0))
    g.output('emissive', g.constant(0, 0, 1))
    g.output('roughness', g.constant(0.2))
  }
  const unlit = graphText(wire, { lit: false })
  assert.match(unlit, /rgb=max\(mgEmissive\(mgPixel,mgGiven\),vec3f\(0\.0\)\);/)
  assert.match(unlit, /emissive=vec3f\(0\.0\);/)
  assert.doesNotMatch(unlit, /mgBaseColor|mgRoughness/, 'the other outputs take their defaults')
  const lit = graphText(wire)
  assert.match(lit, /rgb=saturate\(mgBaseColor\(/)
  assert.match(lit, /emissive=max\(mgEmissive\(/)
  const negative = graphText(wire, { allowNegativeEmissive: true })
  assert.match(negative, /emissive=mgEmissive\(mgPixel,mgGiven\);/)
  assert.doesNotMatch(negative, /max\(mgEmissive/)
})

test('a graph that wires the specular leaves it in the surface flags of a lit pixel, and only then', () => {
  const wired = graphText((g) => g.output('specular', g.constant(0.8)))
  assert.match(
    wired,
    /if\(\(page\.flags&\d+u\)!=0u\)\{flag\|=specularFlag\(saturate\(mgSpecular\(mgPixel,mgGiven\)\)\);\}/,
  )
  assert.doesNotMatch(
    graphText((g) => g.output('roughness', g.constant(0.3))),
    /flag\|=specularFlag\(saturate/,
  )
  // A resolve with no graph leaves a specular only for an eye's caustic (`materialModelWgsl.ts`), never the graph's.
  assert.doesNotMatch(SHADE_SHADER, /flag\|=specularFlag\(saturate/)
  // The refraction is the transparent pass's: the opaque resolve compiles none.
  assert.doesNotMatch(
    graphText((g) => g.output('refraction', g.constant(1.5))),
    /mgRefraction/,
  )
})

test('a graph that wires an opacityMask is read as masked: the mask is compiled, the resolve cuts nothing and asks the mask’s tiles', () => {
  const graph = material.graph('surface')
  const wave = graph.textureSample(new WorldTexture(), { uv: graph.texCoord(0) })
  graph.output('baseColor', graph.constant(1, 0, 0))
  graph.output('opacityMask', graph.channel(wave, 'a'))
  const program = programOf({ graph })
  assert.ok(isProgram(program))
  assert.ok(program.compiled.functions.opacityMask, 'the mask is compiled with the surface')
  assert.equal(program.compiled.reads, 1, 'its texture is one of the program’s reads')
  const text = shadeShader({ graph: program.compiled })
  // The pixel asks the tile of the mask's texture (the raster, which cuts, reads at what the
  // streamer brought), and no pixel is dropped here: the raster's test is the only cutout.
  assert.match(text, /fn shadePick\(p:RequestPick,missing:bool,m:Material\)->u32\{return mgAsk\(/)
  assert.doesNotMatch(text.slice(text.indexOf('fn shadeSurface')), /mgOpacityMask|discard/)
  // A graph that wires none compiles none.
  const none = material.graph('surface')
  none.output('baseColor', none.constant(1, 0, 0))
  const plain = programOf({ graph: none })
  assert.ok(isProgram(plain) && !plain.compiled.functions.opacityMask)
})

test('a graph that wires its shading model picks the model per pixel: unlit leaves unlit, the coat and the thin subsurface are their models’ own', () => {
  const wired = graphText((g) => {
    g.output('shadingModel', g.constant(4))
    g.output('clearCoat', g.constant(0.5))
    g.output('subsurfaceColor', g.constant(0.5))
  })
  assert.match(wired, /let mgModel=i32\(round\(mgShadingModel\(/)
  assert.match(wired, /if\(mgModel==0\)\{rgb=[^;]*;emissive=vec3f\(0\.0\);metal=0\.0;ao=1\.0;\}/)
  assert.match(wired, /if\(mgModel==0\)\{flag=\(flag&~7u\)\|1u;\}/)
  assert.match(wired, /select\(0\.0,saturate\(mgClearCoat\([^;]*\),mgModel==4\)/)
  assert.match(wired, /if\(mgModel!=6\)\{thin=vec3f\(0\.0\);\}/)
  // The thin subsurface is a pixel model: its colour and opacity in the target, the transmission mark set.
  assert.match(
    wired,
    /if\(mgModel==2\)\{\s*thinOut=clamp\([^;]*;thinOpacity=[^;]*;\s*if\(any\(thinOut>vec3f\(0\.0\)\)\)\{flag\|=32u;\}/,
  )
  // Unwired, the surface keeps its model and its lobes whole.
  const plain = graphText((g) => g.output('clearCoat', g.constant(0.5)))
  assert.doesNotMatch(plain, /mgModel/)
})

test('a surface the transparent pass shades compiles its shading model for the blend program, which lights and reflects by it', () => {
  const graph = material.graph('surface')
  graph.output('shadingModel', graph.constant(0))
  const program = programOf({ graph, transparent: true })
  assert.ok(isProgram(program) && program.kind === 'blend')
  assert.ok(
    program.compiled.functions.shadingModel,
    'the output is compiled for the transparent pass',
  )
  // A material that names its model itself leaves the output out (`modelFromGraph`).
  const named = programOf({ graph, transparent: true, modelFromGraph: false })
  assert.ok(isProgram(named) && !named.compiled.functions.shadingModel)
})

test('a graph that wires a cloth gives the lobes the fuzz colour of its subsurfaceColor and the amount of its cloth, and no thin transmission', () => {
  const cloth = graphText((g) => {
    g.output('cloth', g.constant(0.7))
    g.output('subsurfaceColor', g.constant(0.2, 0.3, 0.4))
  })
  assert.match(
    cloth,
    /physicalRecord\.sheen=vec4f\(clamp\(mgSubsurfaceColor\([^;]*,vec3f\(0\.0\),vec3f\(1\.0\)\),saturate\(mgCloth\(/,
  )
  assert.doesNotMatch(
    cloth,
    /thin=clamp\(mgSubsurfaceColor/,
    'the output is the fuzz colour, not a transmission',
  )
  // The model picks the cloth per pixel: another model has none, and the thin transmission is the
  // subsurface models' own.
  const picked = graphText((g) => {
    g.output('shadingModel', g.constant(8))
    g.output('cloth', g.constant(0.7))
    g.output('subsurfaceColor', g.constant(0.2, 0.3, 0.4))
  })
  assert.match(picked, /select\(0\.0,saturate\(mgCloth\([^;]*\),mgModel==8\)/)
  assert.match(picked, /if\(mgModel!=6\)\{thin=vec3f\(0\.0\);\}/)
})

test('a graph that wires the pixelDepthOffset is a surface the rasters evaluate: a cutout row that asks the depth', () => {
  const wired = graphText((g) => g.output('pixelDepthOffset', g.constant(0.5)))
  assert.doesNotMatch(wired, /offsetDepth/, 'the resolve moves no depth: the rasters do')
})
