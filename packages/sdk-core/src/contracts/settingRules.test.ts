// A count is a whole number from its least up, refused in those words; a non-negative number is a
// finite one of at least zero: the two a family's rules write through one constructor each; two
// readings of a family differ where one of its settings does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { defineModule, mergeModuleParts, resolveModuleOption } from '../modules/descriptor.ts'
import {
  countSetting,
  nonNegativeSetting,
  resolveSetting,
  resolveSettings,
  rulesOf,
  settingsDiffer,
} from './settingRules.ts'

test('a count takes whole numbers from its least up and refuses the rest in words', () => {
  const frames = countSetting('frames', 5, 0),
    cells = countSetting('cells', 4, 1)
  assert.equal(resolveSetting(frames, 0), 0)
  assert.equal(resolveSetting(cells, null), 4)
  assert.throws(() => resolveSetting(cells, 0), /a whole number of at least 1, got 0/)
  assert.throws(() => resolveSetting(frames, 1.5), /a whole number of at least 0, got 1.5/)
  assert.throws(() => resolveSetting(frames, -1), /at least 0/)
})

test('a non-negative setting takes any finite number of at least zero', () => {
  const scale = nonNegativeSetting('scale', 1)
  assert.equal(resolveSetting(scale, 0), 0)
  assert.equal(resolveSetting(scale, 2.5), 2.5)
  assert.throws(() => resolveSetting(scale, -0.1), /a finite number of at least 0/)
  assert.throws(() => resolveSetting(scale, Infinity), /a finite number of at least 0/)
})

test('two readings of a family differ where one of its settings does', () => {
  const rules = rulesOf([countSetting('frames', 5, 0), nonNegativeSetting('scale', 1)] as const)
  const used = resolveSettings(rules, { scale: 2 })
  assert.equal(settingsDiffer(rules, used, resolveSettings(rules, { scale: 2 })), false)
  assert.equal(settingsDiffer(rules, used, resolveSettings(rules, { scale: 3 })), true)
  assert.equal(settingsDiffer(rules, used, resolveSettings(rules, { scale: 2, frames: 6 })), true)
})

// A module's option is read by one resolver, and the sources' parts merge field by field.
test('a module option is true, false, silent or an object of its parts, and nothing else', () => {
  const sky = defineModule({
    name: 'sky',
    enabledByDefault: false,
    requires: [],
    parts: ['clouds'],
  })
  assert.deepEqual(resolveModuleOption(sky, true), { parts: {} })
  assert.equal(resolveModuleOption(sky, false), false)
  assert.equal(resolveModuleOption(sky, null), undefined)
  assert.throws(() => resolveModuleOption(sky, { fog: true }), /unknown part "fog"/)
  assert.throws(() => resolveModuleOption(sky, { clouds: 3 as never }), /neither a boolean/)
  const stronger = { parts: { clouds: { a: 1 } } },
    weaker = { parts: { clouds: { a: 2, b: 3 } } }
  assert.deepEqual(mergeModuleParts(sky, [stronger, weaker]), { clouds: { a: 1, b: 3 } })
  assert.deepEqual(mergeModuleParts(sky, [{ parts: { clouds: false } }, weaker]), { clouds: false })
})
