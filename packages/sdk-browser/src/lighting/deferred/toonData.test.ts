// The toon data of the lit image (`ContractKey.toonData`): the passes of the lights add each toon pixel's unramped diffuse light and its weights to two more
// targets, which the step after the lights reads; a program that does not write them has no trace of it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { FULL_CONTRACT, cutsIn, variantLabel } from './contractCuts.ts'
import { localPassWgsl, sunPassWgsl } from './lightPassWgsl.ts'
import { perLightPassWgsl } from './perLightPassWgsl.ts'
import { TILE_CLASS, type TileClass } from './tileClass.ts'
import { TOON_DATA_FORMATS, lightPipelineDescriptor } from './tilePass.ts'
import { createToonDataTargets } from './toonData.ts'

const WITH = { ...FULL_CONTRACT, toonData: true }
const text = (decl: WgslDecl) => wgslModule(decl)

test('the toon data is a program of its own, no cut: its label says it and its cuts are those of the program without it', () => {
  assert.equal(cutsIn(WITH), cutsIn(FULL_CONTRACT))
  assert.match(variantLabel(WITH), /_TOON_DATA$/)
  assert.doesNotMatch(variantLabel(FULL_CONTRACT), /TOON_DATA/)
})

test('the passes of the lights of a class that holds the models write the toon data beside the light', () => {
  for (const [name, code, entry] of [
    ['the sun’s', text(sunPassWgsl(WITH, TILE_CLASS.single)), 'sunMain'],
    ['the local lights’', text(localPassWgsl(WITH, TILE_CLASS.single)), 'localMain'],
    ['a light’s own', text(localPassWgsl(WITH, TILE_CLASS.single, { loop: 'one' })), 'localMain'],
    ['the per-light draw’s', text(perLightPassWgsl(WITH, TILE_CLASS.single)), 'perLightMain'],
  ] as const) {
    assert.match(
      code,
      /struct LitOut\{@location\(0\) light:vec4f,@location\(1\) toon0:vec4f,@location\(2\) toon1:vec2f,\}/,
      name,
    )
    assert.match(
      code,
      new RegExp(`fn ${entry}\\(@builtin\\(position\\) pixel:vec4f\\)->LitOut\\{`),
      name,
    )
    assert.match(code, /return litOut\(lightOut\(/, name)
    assert.match(code, /toonUnified=\(modelBits&/, name)
  }
})

test('the plain class, and the program without the toon data, write the light alone', () => {
  assert.doesNotMatch(text(sunPassWgsl(WITH, TILE_CLASS.simple)), /LitOut/)
  const plain = text(localPassWgsl(FULL_CONTRACT, TILE_CLASS.single))
  assert.doesNotMatch(plain, /LitOut|toonUnified=\(modelBits|toonMain|toonData0/)
  assert.match(plain, /fn localMain\(@builtin\(position\) pixel:vec4f\)->@location\(0\) vec4f\{/)
})

test('the pass after the lights reads the toon data in the second group and applies the ramp once', () => {
  const code = text(localPassWgsl(WITH, TILE_CLASS.single))
  assert.match(code, /@group\(1\) @binding\(0\) var toonData0:texture_2d<f32>;/)
  assert.match(code, /@group\(1\) @binding\(1\) var toonData1:texture_2d<f32>;/)
  assert.match(code, /fn toonMain\(@builtin\(position\) pixel:vec4f\)->@location\(0\) vec4f\{/)
  assert.match(
    code,
    /toonApplyDiffuse\(textureLoad\(toonData0,coord,0\)\.rgb,textureLoad\(toonData1,coord,0\)\.rg\)/,
  )
  // No light is walked again by it.
  assert.doesNotMatch(code, /toonDiffuseOnly/)
  assert.doesNotMatch(code.split('fn toonMain')[1].split('@fragment')[0], /sliceLighting/)
})

test('the pipelines of a program that writes the toon data name its targets, written by the classes that hold toon pixels only', () => {
  const device = { createPipelineLayout: () => ({}) } as unknown as GPUDevice
  const modules = [{}, {}] as GPUShaderModule[]
  const targets = (tileClass: TileClass, toon?: { writes: boolean }) =>
    lightPipelineDescriptor(device, modules, {} as GPUBindGroupLayout, 'e', 'l', tileClass, toon)
      .fragment!.targets as GPUColorTargetState[]
  assert.equal(targets(TILE_CLASS.single).length, 1, 'no toon data: the light alone')
  const written = targets(TILE_CLASS.single, { writes: true })
  assert.deepEqual(
    written.map((t) => t?.format),
    ['rgba16float', TOON_DATA_FORMATS.diffuse, TOON_DATA_FORMATS.weights],
  )
  assert.deepEqual(
    written.map((t) => t?.writeMask ?? 0xf),
    [0xf, 0xf, 0xf],
  )
  // The complex class draws with the highest module the program holds (here the single's); the plain class holds the toon targets, writing none.
  assert.equal(targets(TILE_CLASS.complex, { writes: true })[1]?.writeMask, 0xf)
  assert.equal(targets(TILE_CLASS.simple, { writes: true })[1]?.writeMask, 0)
  assert.equal(
    targets(TILE_CLASS.single, { writes: false })[2]?.writeMask,
    0,
    'the shadows’ view and the indirect light write none',
  )
  assert.deepEqual(TOON_DATA_FORMATS, { diffuse: 'rgba16float', weights: 'rg16float' })
})

test('the toon data targets are made at the size of the lit image’s target, and again when it changes', () => {
  const made: { width: number; height: number; format: string }[] = []
  ;(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= {
    RENDER_ATTACHMENT: 16,
    TEXTURE_BINDING: 4,
  }
  const device = {
    createTexture: ({ size, format }: { size: number[]; format: string }) => {
      const texture = {
        width: size[0],
        height: size[1],
        format,
        destroy() {},
        createView: () => ({}),
      }
      made.push(texture)
      return texture
    },
  } as unknown as GPUDevice
  const targets = createToonDataTargets(device)
  const first = targets.ensure(640, 360)
  assert.equal(targets.ensure(640, 360), first, 'the same size, the same views')
  assert.deepEqual(
    made.map((t) => [t.width, t.height, t.format]),
    [
      [640, 360, 'rgba16float'],
      [640, 360, 'rg16float'],
    ],
  )
  assert.notEqual(targets.ensure(800, 450), first)
  assert.equal(made.length, 4)
})
