// The table of the families of settings declared by rule (`SETTING_FAMILIES`) and the surfaces that
// say each setting in words: a row without them is found here, not by a user.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EXPLORER_OPTIONS_SCHEMA } from '../llm/explorerOptionsSchema.ts'
import { TRILLION3D_RUNTIME_TOOLS } from '../llm/runtimeToolsSchema.ts'
import { QUALITY_GROUPS } from './renderSettings.ts'
import { memberOf, setterOf, SETTING_FAMILIES } from './settingFamilies.ts'

test('every setting of every family has a property of the options schema and an argument of a runtime tool', () => {
  const properties = EXPLORER_OPTIONS_SCHEMA.properties as Record<string, unknown>
  const arguments_ = new Set(
    TRILLION3D_RUNTIME_TOOLS.flatMap((tool) => Object.keys(tool.parameters?.properties ?? {})),
  )
  for (const [name, family] of Object.entries(SETTING_FAMILIES))
    for (const field of Object.keys(family.rules)) {
      assert.ok(field in properties, `${name}: ${field} has no property in the options schema`)
      assert.ok(arguments_.has(field), `${name}: ${field} is no argument of a runtime tool`)
    }
})

test('a field belongs to one family, and a family names its quality group, or each group of its rules', () => {
  const owner = new Map<string, string>()
  for (const [name, family] of Object.entries(SETTING_FAMILIES)) {
    for (const field of Object.keys(family.rules)) {
      assert.equal(owner.get(field), undefined, `${field} is in ${owner.get(field)} and ${name}`)
      owner.set(field, name)
    }
    const groups = 'groups' in family ? Object.keys(family.groups) : [family.group]
    for (const group of groups)
      assert.ok((QUALITY_GROUPS as readonly unknown[]).includes(group), name)
    if ('groups' in family) {
      const partitioned = Object.values(family.groups).flatMap((rules) => Object.keys(rules))
      assert.deepEqual(partitioned.sort(), Object.keys(family.rules).sort(), `${name}: its groups`)
    }
  }
})

test('a family’s accessor and session setter are named from its row', () => {
  assert.equal(setterOf('cut'), 'setCut')
  assert.equal(setterOf('indirectLight'), 'setIndirectLight')
  assert.equal(memberOf('exposure'), 'exposureSettings')
  assert.equal(memberOf('film'), 'film')
})
