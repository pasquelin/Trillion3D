// The capsule shadow programs as text: each mode binds what it reads and only that, keeps the tile's barriers in uniform flow, and holds
// no character a template would end on. (The programs run on the device; the CPU side is `plan.test.ts` and `shapes.test.ts`.)
import test from 'node:test'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import assert from 'node:assert/strict'
import { CAPSULE_BINDINGS, CAPSULE_PARAM_BYTES, CAPSULE_PARAMS } from './layout.ts'
import { capsuleShadowShader, type CapsuleMode } from './capsuleShadowWgsl.ts'
import { capsuleHooks } from './hooks.ts'
import { capsuleComposeShader, capsuleUpsampleShader } from './upsampleWgsl.ts'
import { lightDirectionShader } from './lightDirectionWgsl.ts'

const MODES: readonly CapsuleMode[] = ['directional', 'point', 'indirect', 'skylight']

const HOOKS = capsuleHooks('capsuleParams.depth')
const UPSAMPLE_HOOKS = capsuleHooks('upsampleParams.depth')

const shader = (mode: CapsuleMode, casters = false) => capsuleShadowShader(mode, HOOKS, casters)

/** The binding numbers a program declares in group 0. */
const bound = (code: string) =>
  [...code.matchAll(/@group\(0\) @binding\((\d+)\)/g)]
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b)

/** What a mode binds in group 0, by the names of `CAPSULE_BINDINGS`. */
const BINDS: Record<CapsuleMode, readonly (keyof typeof CAPSULE_BINDINGS)[]> = {
  directional: ['params', 'shapes', 'tileCounts', 'factors', 'depth', 'flags'],
  point: ['params', 'shapes', 'tileCounts', 'factors', 'depth', 'flags'],
  indirect: ['params', 'shapes', 'lightData', 'tileCounts', 'factors', 'depth', 'flags'],
  skylight: ['params', 'shapes', 'lightData', 'receiverBentNormal', 'bentNormal', 'depth', 'flags'],
}

test('each mode binds what it reads, at the layout’s numbers', () => {
  for (const mode of MODES) {
    // The depth reader declares its pyramid and levels beside the level 0 the entry reads.
    const wanted = [
      ...BINDS[mode].map((name) => CAPSULE_BINDINGS[name]),
      CAPSULE_BINDINGS.depth + 1,
      CAPSULE_BINDINGS.depth + 2,
    ]
    assert.deepEqual(
      bound(shader(mode)),
      wanted.sort((a, b) => a - b),
      mode,
    )
  }
  // Within the device’s minimum: eight storage buffers, four storage textures.
  for (const mode of MODES) {
    const code = shader(mode)
    assert.ok((code.match(/var<storage/g) ?? []).length <= 8, mode)
    assert.ok((code.match(/texture_storage_2d/g) ?? []).length <= 4, mode)
  }
})

test('the distance-field casters join the indirect shadow only, over the fields’ scene in group 1', () => {
  const code = shader('indirect', true)
  assert.ok(code.includes('fn capsuleTraceCasters(') && code.includes('fn capsuleCullCasters('))
  assert.ok(code.includes('@group(1) @binding(0)') && code.includes('capsuleCasterIndices'))
  assert.ok(bound(code).includes(CAPSULE_BINDINGS.casterIndices))
  assert.ok(!shader('indirect').includes('capsuleTraceCasters'))
  assert.throws(() => shader('point', true), RangeError)
  assert.ok((code.match(/var<storage/g) ?? []).length <= 8)
  // The caster list is cleared and culled before the tile’s last barrier, and a pixel with no weight adds nothing to the mean.
  assert.ok(code.lastIndexOf('capsuleCullCasters(index') < code.lastIndexOf('workgroupBarrier()'))
  assert.ok(code.includes('if(weight>0.0){'))
})

test('the uniform struct holds as many words as the layout writes', () => {
  const code = shader('directional')
  const fields = code.match(/struct CapsuleParams\{([^}]*)\}/)?.[1] ?? ''
  const words = [...fields.matchAll(/:(mat4x4f|vec4f)/g)].reduce(
    (sum, match) => sum + (match[1] === 'mat4x4f' ? 16 : 4),
    0,
  )
  assert.equal(words * 4, CAPSULE_PARAM_BYTES)
  assert.equal(CAPSULE_PARAMS.translation + 4, words)
})

test('the tile’s barriers stand at the entry’s top level, never inside a branch or a loop', () => {
  for (const mode of MODES) {
    const code = shader(mode)
    const entry = code.slice(code.indexOf('fn capsuleShadow('))
    let depth = 0
    for (const line of entry.split('\n')) {
      if (line.includes('workgroupBarrier()')) assert.equal(depth, 1, `${mode}: ${line}`)
      for (const char of line) {
        if (char === '{') depth++
        else if (char === '}') depth--
      }
    }
    assert.equal((entry.match(/workgroupBarrier\(\)/g) ?? []).length, 4, mode)
    assert.ok(!/workgroupBarrier\(\)/.test(code.slice(0, code.indexOf('fn capsuleShadow('))), mode)
  }
})

test('the modes differ where the reference’s do', () => {
  const [directional, point, indirect, skylight] = MODES.map((mode) => shader(mode))
  assert.ok(point.includes('fn capsuleCone(sphere:vec4f)') && point.includes('toLight/distance'))
  assert.ok(directional.includes('capsuleParams.lightAim.xyz,cos(capsuleParams.lightAim.w)'))
  // Only a point light thins a shape’s shadow by its distance to the light, and only a point light bounds its tile by the light’s reach.
  assert.ok(point.includes('distanceToSphere-lightDistance+shape.radius'))
  for (const code of [directional, indirect, skylight])
    assert.ok(!code.includes('distanceToSphere-lightDistance'))
  assert.ok(point.includes('1.0/capsuleParams.lightPosition.w'))
  assert.ok(!directional.includes('1.0/capsuleParams.lightPosition.w'))
  // The indirect kinds read each shape’s light and scale a capsule to a sphere; the lights’ shadows replace it by its nearest sphere.
  for (const code of [indirect, skylight]) {
    assert.ok(code.includes('capsuleLightData(') && code.includes('capsuleFadedRadius('))
    assert.ok(code.includes('shape.radius/(0.5*shape.length+shape.radius)'))
    assert.ok(code.includes('mix(minVisibility,1.0,cone)'))
  }
  for (const code of [directional, point]) {
    assert.ok(!code.includes('capsuleLightData(') && !code.includes('capsuleLights'))
    assert.ok(code.includes('let span=shape.orientation*shape.length'))
  }
  // Only the movable sky light writes the bent normal, lessens the shadow on a caster’s own surface and keeps the depth in half range.
  assert.ok(
    skylight.includes('textureStore(capsuleBent') && skylight.includes('min(depth,65500.0)'),
  )
  assert.ok(
    skylight.includes('capsuleCastsIndirect(pixel)') &&
      !indirect.includes('capsuleCastsIndirect(pixel)'),
  )
  for (const code of [directional, point, indirect])
    assert.ok(code.includes('capsuleTileCounts[group.y'))
  assert.ok(!skylight.includes('capsuleTileCounts'))
})

test('the faults of the reference are not carried: the tile’s box from its corners, a capsule along the ray, a shape of no radius', () => {
  const code = shader('directional')
  assert.ok(code.includes('for(var corner=0u;corner<4u;corner++)'))
  assert.ok(code.includes('acrossSquared>1.0e-6*shape.length*shape.length'))
  assert.ok(code.includes('if(!(shape.radius>0.0)){continue;}'))
})

test('no program holds a backtick, and each declares its entry', () => {
  for (const mode of MODES) {
    const code = shader(mode)
    assert.ok(!code.includes('`'), mode)
    assert.match(code, /@compute @workgroup_size\(8,8,1\)\nfn capsuleShadow\(/)
  }
  for (const ssao of [false, true]) {
    const code = capsuleUpsampleShader(UPSAMPLE_HOOKS, ssao)
    assert.ok(!code.includes('`'))
    assert.ok(
      code.includes('fn capsuleUpsampleVertex(') && code.includes('fn capsuleUpsampleFragment('),
    )
    assert.equal(code.includes('@location(1) occlusion'), ssao)
  }
  const directions = lightDirectionShader(true)
  assert.ok(
    directions.includes('fn lightDirection(') && directions.includes('skyDominantDirection()'),
  )
  assert.ok(
    !lightDirectionShader(false).includes('vlmBrickUvs') &&
      lightDirectionShader(false).includes('@group(2) @binding(0)'),
  )
  assert.ok(directions.includes('fn vlmBrickUvs(') && directions.includes('@group(1) @binding(0)'))
})

test('the upsample weighs the four factors by the grid, the depths and their validity, and square-roots an attenuation', () => {
  const code = capsuleUpsampleShader(UPSAMPLE_HOOKS, false)
  assert.ok(code.includes('1.0/(abs(depths-vec4f(sceneDepth))+0.0001)'))
  assert.ok(code.includes('color=vec4f(sqrt(shadow))'))
  assert.ok(code.includes('if(upsampleCounts[tile]==0u)'))
})

test('the composition into a sun’s mask takes the minimum of the layer and the shared upsample, tile by tile', () => {
  const code = capsuleComposeShader(UPSAMPLE_HOOKS)
  assert.ok(!code.includes('`'))
  assert.ok(
    code.includes('fn capsuleComposeSun(') &&
      code.includes('texture_storage_2d_array<r32float,read_write>'),
  )
  assert.ok(code.includes('min(held,shadow)') && code.includes('upsampleCounts[tile]==0u'))
  // The draw and the composition read the factors through one function.
  assert.ok(
    code.includes('fn capsuleUpsampledShadow(') &&
      capsuleUpsampleShader(UPSAMPLE_HOOKS, false).includes('capsuleUpsampledShadow(position.xy)'),
  )
})

test('the indirect pass reads the capsule factors only in the program that asks, and applies them to the indirect light alone', async () => {
  const { indirectPassWgsl } = await import('../deferred/indirectPassWgsl.ts')
  const { TILE_CLASS } = await import('../deferred/tileClass.ts')
  const base = { bounce: false, skyShadowing: false, tileClass: TILE_CLASS.single }
  const text = (capsule: boolean | undefined) => wgslModule(indirectPassWgsl({ ...base, capsule }))
  const plain = text(undefined)
  assert.ok(!plain.includes('capsuleIndirect') && !plain.includes('capsuleFactor'))
  assert.equal(plain, text(false))
  const capsule = text(true)
  assert.ok(
    capsule.includes('fn capsuleIndirectAt(') &&
      capsule.includes('let capsuleFactor=capsuleIndirectAt(coord);'),
  )
  assert.ok(capsule.includes('*capsuleFactor'))
})
