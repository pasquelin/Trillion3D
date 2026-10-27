// The blend programs — every translucent layer's — are keyed as the opaque resolve's
// (`createForwardVariants`): every
// frame is lit by a program that holds each code path its lights need — the shadow read where a
// light holds a shadow slot, the rectangle's term where one is a rectangle —, the one its key names
// once compiled, never compiled during a frame; prepare compiles the first frame's alone, its twin
// (every code path but the lobes it has not) from the first frame no ready program serves, and a
// lobed frame compiles its own then.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createForwardVariants } from '../lighting/deferred/forwardVariants.ts'
import { FULL_CONTRACT, type ContractKey } from '../lighting/deferred/contractCuts.ts'
import { createWebgpuBlendPipelines } from './pipelines.ts'
import { mountDevice } from './translucentScene.fixture.ts'
import { blendShader } from './shader.ts'
import { blendVertexWgsl } from './vertexWgsl.ts'
import { blendFrontShader } from './frontStageWgsl.ts'
import { transmitWgsl } from './transmission/transmitWgsl.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import type { BlendGpuItem } from './state.ts'
import { functionsOf } from '../materials/texture/shaderRule.fixture.ts'
import { TRANSLUCENT_SHADOW_DEFAULT } from '../lighting/direct/shadowWgsl.ts'
import { NO_VERTEX_READS, cloudVertexText } from './cloudVertexText.ts'
import {
  VSM_TRACE_KINDS_BOTH,
  VSM_TRACE_KINDS_SUN,
  vsmTraceKindsOf,
} from '../lighting/shadows/vsm/trace/traceWgsl.ts'

/** Every key a scene can ask (`contractKey`): `unshadowed` leaves out both kinds' reads, so no
 *  kind is cut beside it, and a shadowed scene casts from at least one kind. A forward program holds no
 *  contact shadow: its keys always say so. */
const KEYS: ContractKey[] = [false, true].flatMap((rectless) =>
  [
    [true, false, false],
    [false, false, false],
    [false, true, false],
    [false, false, true],
  ].map(([unshadowed, sunless, localless]) => ({
    narrow: false,
    unshadowed,
    rectless,
    sunless,
    localless,
    lobeless: false,
    contactless: true,
    channelless: false,
    profileless: true,
    cubeless: true,
  })),
)
/** The key the tests name: a rectless scene with shadow code. */
const RECTLESS = KEYS.find(
  (key) => key.rectless && !key.unshadowed && !key.sunless && !key.localless,
)!
const settled = () => new Promise((resolve) => setImmediate(resolve))
/** Variants whose programs are their keys, recording each compile. The first frame's key is
 *  narrow, as a scene's of few lights (`contractKey`): a forward pass reads no narrow list. */
async function keyed(first: ContractKey, refuse?: (key: ContractKey) => boolean) {
  const built: ContractKey[] = [],
    said: unknown[] = []
  const key = { ...first, narrow: true }
  const lit = { precompile: true, key, onFailure: (error: unknown) => said.push(error) }
  const programs = await createForwardVariants(async (key) => {
    built.push(key)
    if (refuse?.(key)) throw new Error('REFUSED')
    return key
  }, lit)
  const programOf = (key: ContractKey) => programs.pick(key, !key.lobeless)
  return { programOf, built, said }
}

test('prepare compiles the first frame’s program alone; a frame takes the one that serves it, its twin built when none does', async () => {
  for (const first of KEYS) {
    const { programOf, built } = await keyed(first)
    assert.deepEqual(built, [first], 'no twin before a frame needs a stand-in')
    assert.deepEqual(programOf(first), first, 'the first frame is lit by its own program')
    assert.deepEqual(built, [first], 'served by its own: still no twin')
    for (const key of KEYS) {
      // Asked now: no stand-in lacking code the frame needs is lent meanwhile.
      programOf(key)
      await settled()
      assert.deepEqual(programOf(key), key, 'its own program, once compiled off the frame')
    }
    assert.equal(built.length, KEYS.length, 'each key compiled once')
  }
})

test('a lobeless first frame compiles no lobe code; a lobed frame compiles its own then', async () => {
  const lobeless = { ...RECTLESS, lobeless: true }
  const { programOf, built } = await keyed(lobeless)
  assert.deepEqual(built, [lobeless])
  // None while its own compiles: the first program lacks the lobe code the frame needs.
  assert.equal(programOf(RECTLESS), undefined)
  await settled()
  assert.deepEqual(programOf(RECTLESS), RECTLESS)
  assert.deepEqual(built, [lobeless, RECTLESS])
})

test('a refused first program is said and the twin serves; a twin nothing needed is never built to be refused', async () => {
  const { programOf, said } = await keyed(RECTLESS, (key) => key.rectless)
  assert.equal(said.length, 1)
  // The twin was prepared in the first program's place.
  assert.deepEqual(programOf(RECTLESS), { ...FULL_CONTRACT, contactless: true })
  await assert.doesNotReject(keyed(RECTLESS, (key) => !key.rectless))
  const { programOf: lent } = await keyed(RECTLESS, (key) => !key.rectless)
  assert.equal(
    lent(FULL_CONTRACT),
    undefined,
    'the first program lacks the code the full key needs',
  )
})

/** The light loop of the program a blend pipeline draws with. */
const code = (pipeline: unknown) =>
  ((pipeline as GPURenderPipelineDescriptor).fragment!.module as unknown as { code: string }).code
const loopOf = (pipeline: GPURenderPipelineDescriptor) =>
  functionsOf(code(pipeline), ['declaredLight'])

test('the translucent layers draw with the program of the frame’s key', async () => {
  const mount = mountDevice()
  const create = mount.device.createShaderModule.bind(mount.device)
  mount.device.createShaderModule = (descriptor) =>
    Object.assign(create(descriptor), { code: descriptor.code })
  const items = [true, false].map(
    (transmissive) =>
      ({ transmissive, surface: { blending: 'normal', baseColor: [1, 1, 1] } }) as BlendGpuItem,
  )
  const first = { ...FULL_CONTRACT, narrow: true, unshadowed: true, rectless: true }
  // A rectangle light is lit as a rectangle only where the project switch says, off by default:
  // the program holds the rectangle code where the switch and the key both keep it.
  for (const translucentRectLights of [false, true]) {
    const { blendPipelines } = await createWebgpuBlendPipelines(
      mount.device,
      items,
      undefined,
      true,
      undefined,
      false,
      { lit: { precompile: true, key: first }, translucentRectLights },
    )
    for (const key of [first, ...KEYS]) {
      blendPipelines.lit(key, true)
      await settled()
      const loop = loopOf(
        blendPipelines.lit(key, true)?.at(0) as unknown as GPURenderPipelineDescriptor,
      )
      const label = `${translucentRectLights} ${JSON.stringify(key)}`
      assert.equal(loop.includes('isRect(light)'), translucentRectLights && !key.rectless, label)
      assert.equal(loop.includes('shadowFactor('), !key.unshadowed, label)
      // The read keeps the light kinds the key keeps (`vsmTraceKindsOf`), the local lights only under
      // `shadowTranslucentLocalLights`; a program left no kind reads no map (`directShadowWgsl`).
      if (key.unshadowed) continue
      const text = code(blendPipelines.lit(key, true)?.at(0))
      const kinds =
        vsmTraceKindsOf(key) &
        (TRANSLUCENT_SHADOW_DEFAULT.localShadows ? VSM_TRACE_KINDS_BOTH : VSM_TRACE_KINDS_SUN)
      if (kinds) assert.ok(text.includes(`override VSM_TRACE_KINDS:u32=${kinds}u`), label)
      else assert.ok(!text.includes('override VSM_TRACE_KINDS'), label)
    }
  }
})

// A program that reads the clouds per vertex (`cloudVertex`: the project switch
// `cloudShadowOnTranslucent`, or a scene with a `cloudFog` surface) is one more variant of the blend
// programs: its text, word for word the plain text without it.
/** The code of the clouds' shade on translucent surfaces: the vertex's read, the fragments' take of
 *  it. */
const CLOUD_SHADE_CODE = ['cloudShadeAt', 'cloudShadeVertex', 'cloudShadowBlock']

/** The transmissive stages of a program that reads the clouds per vertex: built with the same flag. */
const shadedStage = transmitWgsl({}, false, undefined, { clouds: true, fog: false })

/** The locations the vertex struct of `code` declares. */
const locationsOf = (code: string) =>
  /struct VSOut\{([^}]*)\}/.exec(code)![1].match(/@location\(\d+\)/g)

/** The members the vertex struct of `code` declares, with the program's extras. */
const structOf = (code: string) => /struct VSOut\{([^}]*)\}/.exec(code)![1]

test('the module of a session without the clouds’ shade on translucent surfaces holds none of its code', () => {
  const stage = transmitWgsl({}, false)
  for (const code of [
    blendShader({}),
    blendShader({}, { stage }),
    blendShader({}, { stage, reads: NO_VERTEX_READS }),
    blendFrontShader(1),
    blendFrontShader(2),
    wgslModule(blendVertexWgsl(true)),
    wgslModule(blendVertexWgsl(false)),
  ])
    for (const text of CLOUD_SHADE_CODE)
      assert.ok(!code.includes(text), `${text} is not in the module without the shade`)
})

test('the vertex of the clouds’ shade carries it in an extra of its own, the barycentrics left what they were', () => {
  const corner = 'out.bary=cornerBarycentric(local%3u);'
  const extras = '@location(13) extras0:vec4f,@location(14) extras1:vec4f,'
  for (const lobes of [true, false]) {
    const plain = wgslModule(blendVertexWgsl(lobes))
    const read = wgslModule(
      blendVertexWgsl(lobes, undefined, cloudVertexText({ clouds: true, fog: true })),
    )
    // The barycentrics are the corner's, plain, with or without the clouds.
    assert.ok(plain.includes(corner) && read.includes(corner))
    assert.match(read, /cloudShade=cloudShadeAt\(out\.view\);/)
    // The shade in the one lane of the second extra, the layer in the whole first.
    assert.match(read, /out\.extras1\.x=cloudShade;/)
    // The struct is the plain one and the two extras, past the thirteen locations every program has.
    assert.equal(structOf(read).replace(extras, ''), structOf(plain))
    assert.equal(locationsOf(plain)!.length, 13)
    assert.equal(locationsOf(read)!.length, 15, 'fifteen, and the front face: the sixteen')
  }
  const plain = blendShader({}, { stage: transmitWgsl({}, false) })
  const read = blendShader({}, { stage: shadedStage, reads: { clouds: true, fog: false } })
  assert.equal(locationsOf(read)!.length, 15)
  assert.equal(locationsOf(plain)!.length, 13, 'no fog per vertex: no extra')
  const fogged = blendShader(
    {},
    {
      stage: transmitWgsl({}, false, undefined, { clouds: false, fog: true }),
      reads: { clouds: false, fog: true },
    },
  )
  assert.equal(locationsOf(fogged)!.length, 14, 'the fog per vertex rides in one extra')
})

test('a fragment of the clouds’ shade takes the shade its vertices gave it, from the extra the vertex wrote it in', () => {
  const plain = blendShader({}, { stage: transmitWgsl({}, false) })
  const read = blendShader({}, { stage: shadedStage, reads: { clouds: true, fog: false } })
  const entries = [
    ...read.matchAll(/@fragment fn \w+\(in:VSOut\b[^{]*\{(\s*cloudShadeVertex=in\.extras1\.x;)?/g),
  ]
  assert.equal(entries.length, 11, 'the lit, covered, responsive, holdout and transmissive ones')
  assert.ok(
    entries.every(([, take]) => take),
    'each entry takes the shade first',
  )
  // The barycentrics are read as they were: no function between them and the stage.
  assert.equal(plain.match(/\bin\.bary\b/g)!.length, read.match(/\bin\.bary\b/g)!.length)
  assert.ok(!read.includes('blendBary'))
  // The light of the forward directional light alone: the one the buffer's header names.
  assert.match(
    read,
    /fn cloudShadowOnSurface\(rank:u32,P:vec3f\)->f32\{return select\(1\.0,cloudShadeVertex,directLights\.forwardRank==rank\+1u\);\}/,
  )
  // The block, the one map and the sampler: bound after the light functions' atlas, read by the vertex.
  assert.match(read, /@group\(0\) @binding\(35\) var<uniform> cloudShadowBlock:CloudShadowBlock;/)
  assert.match(read, /@group\(0\) @binding\(36\) var cloudShadowMap0:texture_2d<f32>;/)
  assert.match(read, /@group\(0\) @binding\(37\) var cloudShadowSampler:sampler;/)
  assert.doesNotMatch(read, /cloudShadowMap1/, 'the first light’s map alone')
})
