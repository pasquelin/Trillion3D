import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SCOPE, SDK_VERSION } from './base.ts'
import { assertCachePointer } from './cache.ts'
import { jobOptionFields, jobOptionFlags } from './jobOptions.ts'
import { resolveHlod } from './hlodOptions.ts'
import {
  DEFAULT_DRAW_DISTANCE_MAX,
  DEFAULT_DRAW_DISTANCE_MIN,
  DEFAULT_DRAW_DISTANCE_PER_INSTANCE,
} from './objectAbi.ts'
import { resolveObjectSettings } from './objectOptions.ts'
import { CUT_RULES, primitiveDistanceFactor } from './cutOptions.ts'
import { resolveSetting } from './settingRules.ts'

test('the engine version parses as major.minor.patch for a host', () => {
  const parts = SDK_VERSION.split(/[-+]/)[0].split('.').map(Number)
  assert.equal(parts.length, 3, SDK_VERSION)
  for (const part of parts) assert.ok(Number.isSafeInteger(part) && part >= 0, SDK_VERSION)
})

test('a model compiled at the default scope streams in pages', () => {
  const pointer = { status: 'ready', url: 'model/clusters.json', scope: DEFAULT_SCOPE }
  assert.equal(assertCachePointer(pointer, 'slice'), 'model/clusters.json')
})

test('a job naming streaming grids writes them as the compiler reads them and refuses the rest', () => {
  const grids = [{ cellSize: 64 }, { name: 'far', cellSize: 512, loadingRange: 1024 }]
  const wire = [
    { cellSize: 64, loadingRange: 256, priority: 0, origin: [0, 0] },
    { name: 'far', cellSize: 512, loadingRange: 1024, priority: 0, origin: [0, 0] },
  ]
  assert.deepEqual(jobOptionFields({ partitionGrids: grids }).partitionGrids, wire)
  assert.deepEqual(jobOptionFlags({ partitionGrids: grids }), [
    `--partition-grids=${JSON.stringify(wire)}`,
  ])
  assert.deepEqual(jobOptionFields({}), {}, 'a job naming none names none')
  const refused: [object, RegExp][] = [
    [{ partitionGrid: true, partitionGrids: [{}] }, /name them once/],
    [{ partitionGrids: [] }, /one grid or more/],
    [{ partitionGrids: [{}, {}] }, /partitionGrids\[1\]: name is required/],
    [{ partitionGrids: [{}, { name: 'a:b' }] }, /none of :\./],
    [{ partitionGrids: [{ name: 'A' }, { name: 'a' }] }, /names a grid already/],
    [
      { partitionScheme: 'spatialHash', partitionGrids: [{}, { name: 'x', nestedLevels: false }] },
      /nestedLevels is the whole partition's/,
    ],
    [{ partitionGrids: [{ cellSize: 0 }] }, /partitionGrids\[0\]: cellSize/],
    [{ partitionScheme: 'spatialHash', partitionGrids: [{ flat: false }] }, /read by .* alone/],
    [{ objectSettings: { runtimeGrid: '' } }, /runtimeGrid must be the name of a streaming grid/],
    [{ objectSettings: { runtimeGrid: 'a.b' } }, /runtimeGrid must be .* none of :\./],
    // The scalar settings of a grid are read by their rules: what each takes is the rule's words.
    [
      { partitionGrid: { streamBounds: 'sphere' } },
      /one of 'content', 'cell', 'clipped', got "sphere"/,
    ],
    [{ partitionGrid: { priority: 1.5 } }, /priority must be a whole number from 0 to 4294967295/],
    [
      { partitionGrid: { hlodGrids: [{ loadingRange: 0 }] } },
      /hlodGrids\[0\].loadingRange must be a number of metres above 0/,
    ],
    // The layers a grid lists are names, only a loose grid has them.
    [{ partitionGrid: { hlodLayers: ['a', ''] } }, /hlodLayers must be an array of layer names/],
    [{ partitionGrid: { hlodLayers: 'a' } }, /hlodLayers must be an array of layer names/],
    [{ partitionScheme: 'spatialHash', partitionGrid: { hlodLayers: [] } }, /read by .* alone/],
  ]
  for (const [options, message] of refused)
    assert.throws(() => jobOptionFields(options), message, JSON.stringify(options))
  // Each grid lists the HLOD layers that have grids on it, by name; none listed, every layer's.
  const layers = [{}, { name: 'far', hlodLayers: ['hlod0', 'hlod1'] }]
  assert.deepEqual(
    jobOptionFields({ partitionGrids: layers }).partitionGrids?.map((grid) => grid.hlodLayers),
    [undefined, ['hlod0', 'hlod1']],
  )
  // Flatness is each grid's own; a square setting a later grid names alike is the partition's.
  assert.ok(jobOptionFields({ partitionGrids: [{}, { name: 'x', flat: false }] }).partitionGrids)
  const alike = [{ nestedLevels: true }, { name: 'x', nestedLevels: true }]
  assert.ok(jobOptionFields({ partitionScheme: 'spatialHash', partitionGrids: alike }))
  const rule = { objects: [{ match: 'far', runtimeGrid: 'far' }] }
  assert.deepEqual(jobOptionFields({ objectSettings: rule }).objectSettings, {
    objects: [{ match: { node: 'far' }, runtimeGrid: 'far' }],
  })
})

test('a job naming the responsiveness of materials writes the levels as the compiler reads them and refuses the rest', () => {
  // A level, `true` for the default one and `false` for `off`, by exact material name.
  assert.deepEqual(
    jobOptionFields({
      materials: {
        spark: { responsive: true },
        smoke: { responsive: 'medium' },
        ui: { responsive: false },
      },
    }).materials,
    { spark: { responsive: 'full' }, smoke: { responsive: 'medium' }, ui: { responsive: 'off' } },
  )
  assert.deepEqual(jobOptionFields({ materials: { plain: {} } }).materials, { plain: {} })
  assert.deepEqual(jobOptionFlags({ materials: { spark: { responsive: 'full' } } }), [
    '--materials={"spark":{"responsive":"full"}}',
  ])
  // The share a material once named is no setting any more, nor is a level outside the three.
  assert.throws(
    () => jobOptionFields({ materials: { spark: { temporalAntialiasing: 0.5 } } as never }),
    /materials\.spark has no field temporalAntialiasing: responsive/,
  )
  assert.throws(
    () => jobOptionFields({ materials: { spark: { responsive: 'soft' } } as never }),
    /materials\.spark\.responsive: must be one of off, medium, full, true or false, got soft/,
  )
  assert.throws(
    () => jobOptionFields({ materials: { spark: { responsive: 0.5 } } as never }),
    /materials\.spark\.responsive: must be one of/,
  )
})

test('the simple HLOD form is one chain of layers, four by default, its last streamed on its grid', () => {
  const wire = (options: Parameters<typeof resolveHlod>[0]) => resolveHlod(options)!
  const names = (levels?: number) =>
    wire(levels === undefined ? {} : { levels }).layers.map((layer) => layer.name)
  assert.deepEqual(names(), ['hlod0', 'hlod1', 'hlod2', 'hlod3'])
  assert.deepEqual(names(1), ['hlod0'])
  assert.deepEqual(wire({ levels: 1 }), {
    layers: [{ name: 'hlod0', builder: 'instanced', cellSize: 256, loadingRange: 512 }],
    default: 'hlod0',
  })
  const four = wire({}).layers
  assert.deepEqual(
    four.map((layer) => [layer.builder, layer.parent, layer.cellSize, layer.spatiallyLoaded]),
    [
      ['instanced', 'hlod1', 256, undefined],
      ['merge', 'hlod2', 512, undefined],
      ['merge', 'hlod3', 1024, undefined],
      ['merge', undefined, 2048, undefined],
    ],
  )
  // An object no mark names enters the first layer, unless the form leaves it out.
  assert.equal(wire({ levels: 2 }).default, 'hlod0')
  assert.equal(wire({ levels: 2, default: 'none' }).default, undefined)
  for (const levels of [0, 257, 1.5, Number.NaN])
    assert.throws(() => resolveHlod({ levels }), /levels must be a whole number from 1 to 256/)
  // The groups of an older simple form are no field: the layers are named, by a mark or a rule.
  assert.throws(() => resolveHlod({ groups: {} } as never), /groups/)
  assert.throws(() => resolveHlod({ default: 'foliage' } as never), /default must be none/)
})

test('a job naming the distances an object is drawn at writes them as the compiler reads them: one form for none, the rest refused', () => {
  assert.deepEqual(
    [DEFAULT_DRAW_DISTANCE_MIN, DEFAULT_DRAW_DISTANCE_MAX, DEFAULT_DRAW_DISTANCE_PER_INSTANCE],
    [0, 0, false],
  )
  const resolved = resolveObjectSettings({
    drawDistance: { min: 10, max: 400 },
    objects: [
      { match: 'Grass', drawDistance: { max: 120 } },
      { match: 'Tower', drawDistance: false },
      // A nearest alone is a distance of an object of its own, none of an instance's; no distance
      // at all is none, as false says.
      { match: 'Moss', drawDistance: { min: 5, max: 0 } },
      { match: 'Rock', drawDistance: { min: 5 } },
      { match: 'Gravel', drawDistance: { min: 5, perInstance: true } },
      { match: 'Sand', drawDistance: { min: 0, max: 0 } },
      { match: 'Leaf', drawDistance: { max: 30, perInstance: true } },
    ],
  })
  assert.deepEqual(resolved?.drawDistance, { min: 10, max: 400 })
  assert.deepEqual(
    resolved?.objects?.map((rule) => rule.drawDistance),
    [
      { max: 120 },
      false,
      { min: 5, max: 0 },
      { min: 5 },
      false,
      false,
      { max: 30, perInstance: true },
    ],
  )
  for (const [patch, words] of [
    [{ drawDistance: true }, /drawDistance must be false or an object of min, max, perInstance/],
    [{ drawDistance: { perInstance: 'yes' } }, /drawDistance.perInstance must be true or false/],
    [
      { drawDistance: { min: -1 } },
      /drawDistance.min must be a finite number of at least 0, got -1/,
    ],
    [{ drawDistance: { max: 'far' } }, /drawDistance.max must be a finite number of at least 0/],
    [{ drawDistance: { near: 5 } }, /drawDistance has no field near: min, max, perInstance/],
  ] as const)
    assert.throws(() => resolveObjectSettings(patch as never), words, JSON.stringify(patch))
})

test('the draw distances of an object of its own follow the field of view: one scale at each end, blended between, the reference’s defaults changing nothing', () => {
  // The field of view's scale alone: the view distance scale is 1 at its default.
  const fieldOfViewDistanceScale = (
    fov: number,
    { minAngle, minScale, maxAngle, maxScale }: Record<string, number>,
  ) =>
    primitiveDistanceFactor(
      {
        context: {
          cutViewDistanceFovMinAngle: minAngle,
          cutViewDistanceFovMinAngleScale: minScale,
          cutViewDistanceFovMaxAngle: maxAngle,
          cutViewDistanceFovMaxAngleScale: maxScale,
        },
      },
      fov,
    )
  const rule = { minAngle: 45, minScale: 2, maxAngle: 90, maxScale: 0.5 }
  const at = (fov: number) => fieldOfViewDistanceScale(fov, rule)
  assert.equal(at(0), 2, 'an orthographic view counts as 0 degrees: the minimum angle’s scale')
  assert.equal(at(45), 2)
  assert.equal(at(90), 0.5)
  assert.equal(at(120), 0.5, 'past the maximum angle, its scale')
  assert.equal(at(67.5), 1.25, 'halfway between the two angles, halfway between the two scales')
  const same = { minAngle: 45, minScale: 3, maxAngle: 90, maxScale: 3 }
  assert.equal(fieldOfViewDistanceScale(10, same), 3, 'two equal scales are one scale at any angle')
  const near = { minAngle: 45, minScale: 3, maxAngle: 90, maxScale: 3 + 1e-9 }
  assert.equal(fieldOfViewDistanceScale(10, near), 3 + 1e-9, 'and so are two nearly equal ones')
  const step = { minAngle: 60, minScale: 1, maxAngle: 60, maxScale: 2 }
  assert.deepEqual(
    [59.9, 60, 61].map((fov) => fieldOfViewDistanceScale(fov, step)),
    [1, 2, 2],
  )
  const defaults = {
    minAngle: 45,
    minScale: 1,
    maxAngle: 90,
    maxScale: 1,
  }
  for (const fov of [0, 30, 45, 70, 90, 130])
    assert.equal(fieldOfViewDistanceScale(fov, defaults), 1)
  const context = { cutViewDistanceScale: 0.5, cutViewDistanceFovMaxAngleScale: 0.5 }
  assert.equal(primitiveDistanceFactor({ context }, 90), 0.25, 'times the view distance scale')
  assert.equal(primitiveDistanceFactor({ context }, 45), 0.5, 'and 1 at the minimum angle')
  const { cutViewDistanceFovMinAngle: angle, cutViewDistanceFovMaxAngleScale: top } = CUT_RULES
  assert.deepEqual(
    [angle, top].map((setting) => resolveSetting(setting)),
    [45, 1],
    'the defaults',
  )
  assert.throws(() => resolveSetting(angle, 361), /0 to 360/)
  assert.throws(() => resolveSetting(top, -1), /at least 0/)
})
