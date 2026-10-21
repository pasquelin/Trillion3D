import assert from 'node:assert/strict'
import test from 'node:test'
import { Ajv } from 'ajv'
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts'
import { BOUNCE_SETTINGS } from '../bounce/contracts.ts'
import { explorerSwitch, type ExplorerSwitch } from '../runtime/explorerSwitches.ts'
import { EXPLORER_SWITCH_NAMES } from '../runtime/explorerSwitches.fixture.ts'
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
} from '../contracts/poolBudgets.ts'
import { DEFAULT_TEXTURE_UPLOAD_MS } from '../../../sdk-browser/src/session/memory/textureTransferDefaults.ts'
import { WORLD_STREAMING_RULES } from '../contracts/worldStreamingOptions.ts'
import { resolveSetting, type SettingRule } from '../contracts/settingRules.ts'
import { CUT_RULES } from '../contracts/cutOptions.ts'
import { ANIMATION_RULES } from '../contracts/animationOptions.ts'
import { RASTER_RULES } from '../contracts/rasterOptions.ts'

const validate = new Ajv().compile(EXPLORER_OPTIONS_SCHEMA)
const explorer = { manifestUrl: '/assets/model/manifest.json' }

test('explorer arguments accept a complete host request and keep host extensions', () => {
  assert.equal(
    validate({
      ...explorer,
      interactive: true,
      scope: 'full',
      geometryPoolBytes: 134217728,
      texturePoolBytes: 134217728,
      maxTextureUploadMsPerFrame: 2,
      temporalAntialiasing: false,
      pixelError: 1.5,
      bounce: true,
      bounceBudgetMs: 1,
      importedLights: false,
      preload: 'all',
      stageProfile: true,
      diagnosticDetail: 'trace',
      replicaCount: 4,
      clearColor: 0x123456,
      hostExtension: 'kept',
    }),
    true,
  )
})

test('explorer arguments name every choice the engine takes and refuse the rest', () => {
  assert.equal(validate({}), false)
  assert.equal(validate({ manifestUrl: false }), false)
  for (const field of [
    'interactive',
    'temporalAntialiasing',
    'bounce',
    'importedLights',
    'stageProfile',
  ])
    assert.equal(validate({ ...explorer, [field]: 'true' }), false, field)
  for (const field of ['scope', 'preload', 'diagnosticDetail'])
    assert.equal(validate({ ...explorer, [field]: 'unknown' }), false, field)
  for (const patch of [
    { geometryPoolBytes: 1 },
    { geometryPoolBytes: 'bytes' },
    { texturePoolBytes: 1 },
    { texturePoolBytes: 67108864.5 },
    { maxTextureUploadMsPerFrame: -1 },
    { maxTextureUploadMsPerFrame: 17 },
    { pixelError: -1 },
    { pixelError: 'pixels' },
    { bounceBudgetMs: 0 },
    { bounceBudgetMs: 9 },
    { replicaCount: 2 },
    { replicaCount: '4' },
    { clearColor: 0.5 },
  ])
    assert.equal(validate({ ...explorer, ...patch }), false, JSON.stringify(patch))
})

test('an explorer request naming only its manifest is completed with the engine defaults', () => {
  const request: Record<string, unknown> = { ...explorer }
  assert.equal(new Ajv({ useDefaults: true }).compile(EXPLORER_OPTIONS_SCHEMA)(request), true)
  assert.equal(request.geometryPoolBytes, DEFAULT_GEOMETRY_POOL_BUDGET)
  assert.equal(request.texturePoolBytes, DEFAULT_TEXTURE_POOL_BUDGET)
  assert.equal(request.maxTextureUploadMsPerFrame, DEFAULT_TEXTURE_UPLOAD_MS)
  assert.equal(request.bounceBudgetMs, BOUNCE_SETTINGS.budgetMs)
  for (const [key, property] of Object.entries(EXPLORER_OPTIONS_SCHEMA.properties)) {
    if (property.default === undefined) continue
    assert.notEqual(request[key], undefined, key)
    // Each default, alone, passes the checks of its own field.
    assert.equal(validate({ ...explorer, [key]: request[key] }), true, key)
  }
})

test('a switch the host leaves out is set in the engine as the schema advertises it', () => {
  // The raster's settings, the world streaming's, the cut's and the animation's are read by their
  // contract's one resolver; every other switch is the explorer's.
  const rules: Readonly<Record<string, SettingRule>> = {
    ...RASTER_RULES,
    ...WORLD_STREAMING_RULES,
    ...CUT_RULES,
    ...ANIMATION_RULES,
  }
  const advertised = Object.entries(EXPLORER_OPTIONS_SCHEMA.properties).filter(
    ([, property]) => property.type === 'boolean' && property.default !== undefined,
  )
  const switches = advertised.filter(([key]) => !(key in rules))
  assert.deepEqual(switches.map(([key]) => key).sort(), [...EXPLORER_SWITCH_NAMES].sort())
  for (const [key, property] of switches)
    assert.equal(explorerSwitch({}, key as ExplorerSwitch), property.default, key)
  for (const [key, property] of advertised.filter(([key]) => key in rules))
    assert.equal(resolveSetting(rules[key]), property.default, key)
})

// No pool ceiling: the drawable-page tables start at the pool and grow in place past it.
test('the schema advertises no geometry pool ceiling', () => {
  assert.equal(EXPLORER_OPTIONS_SCHEMA.properties.geometryPoolCeilingBytes, undefined)
})
