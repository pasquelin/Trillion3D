import assert from 'node:assert/strict'
import test from 'node:test'
import * as G from '../../host/graph/graph.fixture.ts'
import { clusterMaterialReason } from './compatibility.ts'
import { clusterValidation } from './validation.ts'
import { featuresOf, physicalLostMask } from '../../scene/physicalMaterialGate.ts'
import { drawPasses } from '../../cluster/batchMesh.ts'
import { hostBlending } from '../../scene/materialBlending.ts'

const position = new G.BufferAttribute(new Float32Array(9), 3)
const NO_COPIES = { plain: [], blended: [], transmissive: [] }
/** A frame validation whose left-out surfaces are heard by reason. */
const validation = () => {
  const heard: string[] = []
  const read = clusterValidation((_material, leftOut) => void (leftOut && heard.push(leftOut)))
  return { ...read, heard }
}
// A stand-in image: these tests never rasterize a texture, only its presence is read
// (`!texture.image`), so a placeholder typed as the DOM's texture-source union is enough.
const FAKE_IMAGE = {} as TexImageSource
const fakeTexture = () => new G.GraphTexture(FAKE_IMAGE)

test('an untextured Basic material needs no unused UV or normal attribute', () => {
  assert.equal(clusterMaterialReason(G.basicSurface(), { position }), undefined)
})

test('a Depth material draws on the autonomous path with no normal attribute', () => {
  assert.equal(clusterMaterialReason(new G.GraphSurface('depth'), { position }), undefined)
})

test('unsupported mutations refuse the autonomous draw before it becomes partial', () => {
  const material = G.standardSurface()
  assert.equal(
    clusterMaterialReason(material, { position }),
    'material standard has no normal attribute',
  )
  material.transparent = true
  assert.equal(
    clusterMaterialReason(material, {
      position,
      normal: new G.BufferAttribute(new Float32Array(9), 3),
    }),
    undefined,
  )
  material.premultipliedAlpha = true
  assert.match(clusterMaterialReason(material, { position })!, /unsupported blend state/)
  material.premultipliedAlpha = false
  material.transparent = false
  material.wireframe = true
  assert.match(clusterMaterialReason(material, { position })!, /unsupported extension/)
  material.wireframe = false
  material.alphaMap = fakeTexture()
  assert.match(clusterMaterialReason(material, { position })!, /unsupported extension/)
})

test('a normal-mapped material needs no tangent attribute: the shader rebuilds the frame', () => {
  const material = G.standardSurface({ normalMap: fakeTexture() })
  assert.equal(
    clusterMaterialReason(material, {
      position,
      normal: new G.BufferAttribute(new Float32Array(9), 3),
      uv: new G.BufferAttribute(new Float32Array(6), 2),
    }),
    undefined,
  )
})

test('a texture selecting UV1 is refused when geometry has only UV0', () => {
  const material = G.basicSurface({ map: fakeTexture() })
  ;(material.map as G.GraphTexture).channel = 1
  assert.match(
    clusterMaterialReason(material, {
      position,
      uv: new G.BufferAttribute(new Float32Array(6), 2),
    })!,
    /no UV1 attribute/,
  )
})

test('one material is validated against every distinct geometry attribute set', () => {
  const material = G.basicSurface({ map: fakeTexture() })
  ;(material.map as G.GraphTexture).channel = 1
  const uv = new G.BufferAttribute(new Float32Array(6), 2)
  const kept = { material, geometry: { attributes: { position, uv, uv1: uv } } },
    left = { material, geometry: { attributes: { position, uv } } }
  const frame = validation()
  frame.validate([kept, left] as never, [], NO_COPIES)
  assert.equal(frame.leaves(kept as never), false)
  assert.equal(frame.leaves(left as never), true)
  assert.deepEqual(frame.heard, ['texture channel 1 has no UV1 attribute'])
})

test('a runtime mutation to a material array is left out by name instead of disappearing', () => {
  const mesh = { material: [G.basicSurface()], geometry: { attributes: { position } } } as never
  const frame = validation()
  frame.validate([mesh], [], NO_COPIES)
  assert.equal(frame.leaves(mesh), true)
  assert.deepEqual(frame.heard, ['material arrays are unsupported'])
})

test('a mutation of a two-sided transparent material is read at the draw, never frozen', () => {
  const source = G.basicSurface({ transparent: true, side: G.DOUBLE_SIDE })
  const mesh = { material: source, geometry: { attributes: { position } } } as never
  assert.deepEqual(drawPasses(source), ['back', 'front'])
  const frame = validation()
  frame.validate([mesh], [], NO_COPIES)
  source.forceSinglePass = true
  assert.deepEqual(drawPasses(source), [undefined], 'one pass on the declared faces')
  source.premultipliedAlpha = true
  frame.validate([mesh], [], NO_COPIES)
  assert.equal(frame.leaves(mesh), true)
  assert.match(frame.heard.join(), /unsupported blend state/)
})

test('a transmissive physical material is a scene copy of the transmission pass, never a cluster', () => {
  const normal = new G.BufferAttribute(new Float32Array(9), 3)
  const glass = G.physicalSurface({ transmission: 1, ior: 1.5, thickness: 0.1 })
  assert.match(clusterMaterialReason(glass, { position, normal })!, /drawn as a scene copy/)
  assert.equal(clusterMaterialReason(glass, { position, normal }, true), undefined)
  const plain = G.physicalSurface()
  assert.equal(clusterMaterialReason(plain, { position, normal }), undefined)
  assert.equal(clusterMaterialReason(plain, { position, normal }, true), undefined)
  // A physical extension is drawn without, by name (#772): never a refusal.
  plain.ior = 1.3
  assert.equal(clusterMaterialReason(plain, { position, normal }), undefined)
  assert.deepEqual(featuresOf(physicalLostMask(plain)), ['ior'])
  glass.ior = 1.3 // the IOR of a transmission is drawn
  glass.clearcoat = 0.5
  glass.thicknessMap = fakeTexture()
  assert.equal(clusterMaterialReason(glass, { position, normal }, true), undefined)
  assert.deepEqual(featuresOf(physicalLostMask(glass)), ['thicknessMap'])
})

test('a transmissive copy mutated into another physical extension is drawn without it', () => {
  const normal = new G.BufferAttribute(new Float32Array(9), 3)
  const glass = G.physicalSurface({ transmission: 1 })
  const copy = { material: glass, geometry: { attributes: { position, normal } } } as never
  const copies = { ...NO_COPIES, transmissive: [copy] }
  const frame = validation()
  frame.validate([], [], copies)
  glass.sheen = 1
  frame.validate([], [], copies) // never a refusal (#772)
  assert.deepEqual(frame.heard, [])
  glass.sheen = 0
  // A blended copy the owner submits is validated like a page: it never transmits.
  frame.validate([], [], { ...NO_COPIES, blended: [copy] })
  assert.equal(frame.leaves(copy), true)
  assert.match(frame.heard.join(), /drawn as a scene copy/)
})

// The gate no longer compares against the host library's own class to find a shader hook: it
// asks whether the material reaches a compile hook other than the one it inherits.
test('a compile hook the host installed is refused, the empty one it inherits is not', () => {
  const normal = new G.BufferAttribute(new Float32Array(9), 3)
  const material = G.standardSurface()
  assert.equal(clusterMaterialReason(material, { position, normal }), undefined)
  material.onBeforeCompile = () => {}
  assert.match(clusterMaterialReason(material, { position, normal })!, /carries a shader hook/)
})

// #346: every named mode reaches the draw; a mode no path draws is refused by name.
test('a named blending is admitted, an unnamed one and a transmissive non-normal one are refused', () => {
  const normal = new G.BufferAttribute(new Float32Array(9), 3)
  for (const mode of ['none', 'normal', 'additive', 'subtractive', 'multiply'] as const)
    assert.equal(
      clusterMaterialReason(G.basicSurface({ transparent: true, blending: hostBlending(mode) }), {
        position,
      }),
      undefined,
      mode,
    )
  const custom = G.basicSurface({ transparent: true, blending: 5 })
  assert.match(clusterMaterialReason(custom, { position })!, /no path draws \(blending 5\)/)
  const glass = G.physicalSurface({ transmission: 1, blending: hostBlending('additive') })
  assert.match(
    clusterMaterialReason(glass, { position, normal }, true)!,
    /transmissive material cannot use additive blending/,
  )
})

test('texels the WebGL2 upload cannot read as stored are refused by name', () => {
  const { attributes } = G.boxGeometry()
  const reason = (...texels: Parameters<typeof G.dataTexture>) =>
    clusterMaterialReason(G.standardSurface({ map: G.dataTexture(...texels) }), attributes)
  assert.equal(reason(new Uint8Array(16), 2, 2), undefined)
  const refused: [RegExp, ...Parameters<typeof G.dataTexture>][] = [
    [/texel format 1022 is unsupported/, new Uint8Array(12), 2, 2, 1022],
    [/8-bit texels only/, new Float32Array(16), 2, 2],
    [/holds 8 bytes, not 2×2 RGBA/, new Uint8Array(8), 2, 2],
  ]
  for (const [refusal, ...texels] of refused) assert.match(reason(...texels) ?? '', refusal)
})
