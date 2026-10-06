import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from './index.ts'

test('material families preserve kind, supplied channels and independent clone edits', () => {
  for (const factory of [
    'meshStandard',
    'meshPhysical',
    'meshBasic',
    'meshPhong',
    'meshLambert',
    'meshToon',
    'meshNormal',
    'meshMatcap',
    'meshDepth',
    'points',
    'line',
    'lineDashed',
  ] as const) {
    const value = material[factory]({ color: [0.2, 0.4, 0.6], opacity: 0.3 })
    assert.equal(value.kind, factory)
    assert.deepEqual(value.surface().baseColor, [0.2, 0.4, 0.6])
    const copy = value.clone()
    copy.color.setRGB(0.7, 0.8, 0.9)
    assert.deepEqual(value.surface().baseColor, [0.2, 0.4, 0.6])
    assert.equal(copy.kind, factory)
    assert.equal(copy.opacity, 0.3)
  }
})

test('physical and Phong defaults survive unrelated parameters and yield to explicit overrides', () => {
  // Glass bends light (an index above air's) and starts opaque and thin; an unrelated parameter
  // keeps that start.
  const glass = material.meshPhysical({ roughness: 0.2 })
  assert.ok((glass.ior as number) > 1)
  assert.deepEqual([glass.thickness, glass.transmission], [0, 0])
  assert.equal(glass.ior, material.meshPhysical().ior)
  const thick = material.meshPhysical({ ior: 1.7, thickness: 2, transmission: 0.8 })
  assert.deepEqual([thick.ior, thick.thickness, thick.transmission], [1.7, 2, 0.8])
  const plastic = material.meshPhong({ color: [0.1, 0.2, 0.3] })
  assert.ok((plastic.shininess as number) > 0, 'a Phong surface starts with a highlight')
  assert.equal(plastic.shininess, material.meshPhong().shininess)
  assert.equal(material.meshPhong({ shininess: 5 }).clone().shininess, 5)
})

test('sprite and shadow defaults produce blended surfaces while explicit opacity wins', () => {
  const sprite = material.sprite({ rotation: 0.75 })
  assert.equal(sprite.rotation, 0.75)
  assert.equal(sprite.sizeAttenuation, true, 'smaller with distance unless told otherwise')
  assert.equal(sprite.surface().alphaMode, 'blend')
  const shadow = material.shadow()
  assert.deepEqual(shadow.surface().baseColor, [0, 0, 0])
  const shade = shadow.surface().opacity
  assert.ok(shade > 0 && shade < 1, 'a shadow darkens what is under it without hiding it')
  assert.equal(shadow.surface().alphaMode, 'blend')
  assert.equal(material.shadow({ opacity: 0.25 }).surface().opacity, 0.25)
  assert.equal(material.sprite({ transparent: false, sizeAttenuation: false }).transparent, false)
})

test('shader factories retain supplied programs and uniform ownership through a clone', () => {
  const uniforms = { amount: { value: 0.75 } }
  const value = material.createShader({
    vertex: 'vertex program',
    fragment: 'fragment program',
    uniforms,
  })
  const copy = value.clone()
  assert.equal(copy.vertex, 'vertex program')
  assert.equal(copy.fragment, 'fragment program')
  assert.ok(copy.uniforms === uniforms)
  assert.ok(value.uniforms === uniforms)
})

test('point and line defaults remain present when only their color is customized', () => {
  const points = material.points({ color: [0.1, 0.2, 0.3] })
  assert.ok((points.size as number) > 0, 'a dot is drawn')
  assert.equal(points.sizeAttenuation, true)
  const line = material.line({ opacity: 0.75 })
  assert.ok((line.linewidth as number) > 0, 'a line is drawn')
  // A dashed line alternates drawn and empty lengths, both visible, at the scale it was drawn.
  const dashed = material.lineDashed({ color: [0.4, 0.5, 0.6] })
  for (const length of [dashed.linewidth, dashed.dashSize, dashed.gapSize, dashed.scale])
    assert.ok((length as number) > 0)
  const configured = material.lineDashed({ dashSize: 7, gapSize: 2, linewidth: 3, scale: 0.5 })
  assert.deepEqual(
    [configured.dashSize, configured.gapSize, configured.linewidth, configured.scale],
    [7, 2, 3, 0.5],
  )
})
