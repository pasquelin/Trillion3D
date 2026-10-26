import assert from 'node:assert/strict'
import test from 'node:test'
import { Ajv } from 'ajv'
import { TRILLION3D_RUNTIME_TOOLS } from './runtimeToolsSchema.ts'
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts'
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts'
import { DIAGNOSTICS, type DiagnosticMode } from '../runtime/diagnostics.ts'
import { validateSceneLight } from '../scene/light/validate.ts'
import type { SceneLight } from '../scene/light/contracts.ts'
import { HALF_PI } from '../../../math/src/constants.ts'
import { FILM_RULES, type FilmField } from '../contracts/filmOptions.ts'
import { COLOR_GRADING_RULES, type ColorGradingField } from '../contracts/colorGradingOptions.ts'

const ajv = new Ajv()
const tool = (name: string) => {
  const found = TRILLION3D_RUNTIME_TOOLS.find((candidate) => candidate.name === name)
  assert.ok(found, name)
  return found
}
const validatorOf = (name: string, options?: ConstructorParameters<typeof Ajv>[0]) =>
  (options ? new Ajv(options) : ajv).compile(tool(name).parameters)

test('every callable tool has a unique API name and a described, well-formed argument schema', () => {
  const seen = new Set<string>()
  for (const { name, description, parameters } of TRILLION3D_RUNTIME_TOOLS) {
    assert.match(name, /^trillion3d_[a-z_]+$/)
    assert.equal(seen.has(name), false, name)
    seen.add(name)
    assert.ok(description.trim().length > 0, name)
    assert.equal(ajv.validateSchema(parameters), true, name)
    for (const property of Object.values(parameters.properties)) {
      assert.ok(property.description.trim().length > 0, name)
      if (property.items) assert.ok(property.items.description.trim().length > 0, name)
    }
  }
  assert.equal(tool('trillion3d_create_explorer').parameters, EXPLORER_OPTIONS_SCHEMA)
  assert.equal(tool('trillion3d_compile_asset').parameters, COMPILER_OPTIONS_SCHEMA)
  for (const schema of [COMPILER_OPTIONS_SCHEMA, EXPLORER_OPTIONS_SCHEMA])
    assert.ok(schema.description?.trim().length)
})

test('runtime tools accept host commands and refuse invalid arguments before dispatch', () => {
  const commands: Record<string, [unknown, unknown[]]> = {
    trillion3d_set_memory_budgets: [
      { geometryPoolBytes: 134217728, texturePoolBytes: 268435456 },
      [{ geometryPoolBytes: 1 }, { texturePoolBytes: '128' }, { extra: 1 }],
    ],
    trillion3d_set_lod_error: [
      { pixelError: 0.5 },
      [{}, { pixelError: -1 }, { pixelError: '1' }, { pixelError: 1, extra: 1 }],
    ],
    trillion3d_set_temporal_antialiasing: [
      { enabled: true },
      [{}, { enabled: 1 }, { enabled: true, extra: 1 }],
    ],
    trillion3d_set_film: [
      { filmGrainIntensity: 0.2, chromaticAberrationQuality: 'off', vignetteType: 'oval' },
      [
        { filmGrainIntensity: -1 },
        { tonemapperQuality: 6 },
        { chromaticAberrationStartOffset: 2 },
        { vignetteType: 'texture' },
        { quantizationDitheringBits: 1.5 },
      ],
    ],
    trillion3d_remove_light: [{ id: 'lamp' }, [{}, { id: 2 }, { id: 'lamp', extra: 1 }]],
    trillion3d_get_metrics: [{}, [{ extra: 1 }]],
  }
  for (const [name, [valid, invalid]] of Object.entries(commands)) {
    const validate = validatorOf(name)
    assert.equal(validate(valid), true, name)
    for (const input of invalid)
      assert.equal(validate(input), false, `${name}: ${JSON.stringify(input)}`)
  }
})

test('the diagnostic tool offers exactly the view modes the engine can show', () => {
  const validate = validatorOf('trillion3d_set_diagnostic')
  for (const mode of Object.keys(DIAGNOSTICS) as DiagnosticMode[])
    assert.equal(validate({ mode }), DIAGNOSTICS[mode].available, mode)
  for (const input of [{}, { mode: 'unknown' }, { mode: 'wireframe', extra: 1 }])
    assert.equal(validate(input), false, JSON.stringify(input))
})

test('a light the tool accepts, the engine accepts; a field bound it refuses, the engine refuses', () => {
  const validate = validatorOf('trillion3d_add_light')
  const complete = {
    point: {
      id: 'bulb',
      kind: 'point',
      color: [1, 0.8, 0.6],
      intensity: 3,
      position: [0, 2, 0],
      range: 8,
    },
    spot: {
      id: 'lamp',
      kind: 'spot',
      color: [0.1, 0.5, 1],
      intensity: 2,
      position: [1, 2, 3],
      direction: [0, -1, 0],
      range: 10,
      outerConeAngle: 0.5,
      castsShadow: true,
      ...{ emitterRadius: 0.1, emitterLength: 0.4, emitterSoftRadius: 0.2 },
      ...{ innerConeAngle: 0.4, inverseSquared: false, radialExponent: 3 },
      ...{ diffuseShare: 0.5, specularShare: 0.25 },
    },
    directional: {
      id: 'sun',
      kind: 'directional',
      color: [1, 1, 1],
      intensity: 4,
      direction: [0, -1, 0],
      angularRadius: 0.0046,
      atmosphereSunIndex: 1,
    },
  }
  const engineAccepts = (light: object) => {
    try {
      validateSceneLight(light as SceneLight)
      return true
    } catch {
      return false
    }
  }
  for (const light of Object.values(complete)) {
    assert.equal(validate(light), true, light.kind)
    assert.equal(engineAccepts(light), true, light.kind)
  }
  for (const key of ['id', 'kind', 'color']) {
    const input: Record<string, unknown> = { ...complete.point }
    delete input[key]
    assert.equal(validate(input), false, `missing ${key}`)
    assert.equal(engineAccepts(input), false, `missing ${key}`)
  }
  // The intensity has a default, its kind's (8 candelas, 10 lux): a light naming none is taken.
  const unnamed: Record<string, unknown> = { ...complete.point }
  delete unnamed.intensity
  assert.equal(validate(unnamed), true, 'missing intensity')
  assert.equal(engineAccepts(unnamed), true, 'missing intensity')
  assert.equal(validate({ ...complete.spot, intensityUnits: 'lumens' }), true)
  assert.equal(engineAccepts({ ...complete.spot, intensityUnits: 'lumens' }), true)
  // An EV of 0 or under is a light (2^ev candelas): the tool takes it as the engine does. The bound
  // that reads two fields — above 0 in any other unit, or off the inverse square — is the engine's
  // alone: a field of the tool's schema reads no neighbour, on every provider.
  const dim = { ...complete.point, intensity: -2, intensityUnits: 'ev' }
  assert.deepEqual([validate(dim), engineAccepts(dim)], [true, true], 'ev -2')
  const off = { ...complete.point, intensity: -1 }
  assert.deepEqual([validate(off), engineAccepts(off)], [true, false], 'candelas -1')
  const flat = { ...dim, inverseSquared: false }
  assert.deepEqual([validate(flat), engineAccepts(flat)], [true, false], 'ev -2, no inverse square')
  for (const [kind, patch] of [
    ['point', { id: 7 }],
    ['point', { kind: 'lantern' }],
    ['point', { kind: 1 }],
    ['point', { color: 'white' }],
    ['point', { color: [0, -0.1, 1] }],
    ['point', { intensity: 'bright' }],
    ['point', { intensityUnits: 'watts' }],
    ['point', { position: 5 }],
    ['point', { position: [0, 'up', 1] }],
    ['point', { range: 0 }],
    ['point', { range: 'far' }],
    ['spot', { direction: 5 }],
    ['spot', { direction: [0, 'up', 1] }],
    ['spot', { outerConeAngle: 0 }],
    ['spot', { outerConeAngle: HALF_PI }],
    ['spot', { outerConeAngle: 1.6 }],
    ['spot', { outerConeAngle: 'wide' }],
    ['spot', { emitterRadius: 0 }],
    ['spot', { emitterLength: 0 }],
    ['spot', { emitterSoftRadius: -1 }],
    ['spot', { innerConeAngle: -0.1 }],
    ['spot', { innerConeAngle: 1.6 }],
    ['spot', { inverseSquared: 'no' }],
    ['spot', { radialExponent: 0 }],
    ['spot', { diffuseShare: 2 }],
    ['spot', { specularShare: -0.5 }],
    ['directional', { angularRadius: -0.1 }],
    ['directional', { angularRadius: 1.6 }],
    ['directional', { atmosphereSunIndex: 2 }],
    ['directional', { atmosphereSunIndex: 'moon' }],
  ] as const) {
    const input = { ...complete[kind], ...patch }
    assert.equal(validate(input), false, JSON.stringify(patch))
    assert.equal(engineAccepts(input), false, JSON.stringify(patch))
  }
  // The tool's own strictness, which the engine does not share: a flag spelled as text, a field
  // it does not know.
  for (const patch of [{ castsShadow: 'true' }, { misspelledOption: true }])
    assert.equal(validate({ ...complete.point, ...patch }), false, JSON.stringify(patch))
})

test('a light that says nothing of shadows gets what the engine makes of that silence', () => {
  const validate = validatorOf('trillion3d_add_light', { useDefaults: true })
  const light: Record<string, unknown> = {
    id: 'sun',
    kind: 'directional',
    color: [1, 1, 1],
    intensity: 4,
    direction: [0, -1, 0],
  }
  const engine = validateSceneLight({ ...light } as unknown as SceneLight)
  assert.equal(validate(light), true)
  assert.equal(light.castsShadow, engine.castsShadow)
})

test('the film tool names every film setting with its rule’s default', () => {
  const { properties } = tool('trillion3d_set_film').parameters
  assert.deepEqual(Object.keys(properties).sort(), Object.keys(FILM_RULES).sort())
  for (const [name, property] of Object.entries(properties))
    assert.equal(property.default, FILM_RULES[name as FilmField].default, name)
})

test('the colour grading tool names every colour setting with its rule’s default, the grade’s eighty among them', () => {
  const { properties } = tool('trillion3d_set_color_grading').parameters
  assert.deepEqual(Object.keys(properties).sort(), Object.keys(COLOR_GRADING_RULES).sort())
  for (const [name, property] of Object.entries(properties)) {
    assert.equal(property.default, COLOR_GRADING_RULES[name as ColorGradingField].default, name)
    assert.ok(property.description, `${name} says what it means`)
  }
  const grade = Object.keys(properties).filter((name) =>
    /^color(Saturation|Contrast|Gamma|Gain|Offset)/.test(name),
  )
  assert.equal(grade.length, 80)
  // The grade's eighty numbers differ by operation, zone and channel alone: each says so in a few
  // words, and what each operation does is said once, in the tool's text.
  for (const name of grade) assert.ok(properties[name].description.length <= 60, name)
  const text = tool('trillion3d_set_color_grading').description
  for (const meaning of [
    'saturation pulls',
    'contrast raises',
    'gamma raises',
    'gain multiplies',
    'offset adds',
  ])
    assert.equal(text.split(meaning).length, 2, `${meaning} … is said once`)
  assert.match(
    properties.tonemapperGamma.description,
    /0\b.*keeps the transfer.*under 1 is read as 1/,
  )
  assert.equal(properties.colorOffsetShadowsBlue.default, 0)
  assert.equal(properties.colorGainHighlightsMaster.default, 1)
})
