// Each HLOD builder's maps in the options schema: exactly the images its compiler reader admits.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts'

/** The images the compiler's reader in `file` (under `hlod/options/`) admits in a layer's `maps`. */
function rustMapFields(file: string) {
  const rust = readFileSync(
    new URL(`../../../asset-compiler-rust/src/hlod/options/${file}`, import.meta.url),
    'utf8',
  )
  const list = /const MAP_FIELDS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)
  assert.ok(list, file)
  return [...list[1].matchAll(/"([^"]*)"/g)].map((word) => word[1])
}

test('each builder names in its maps exactly the images its compiler reader admits', () => {
  const layerProperties =
    COMPILER_OPTIONS_SCHEMA.properties.hlod.properties?.layers?.items?.properties
  const layerMaps = layerProperties?.maps?.anyOf?.map((branch) =>
    Object.keys(branch.properties ?? {}),
  )
  assert.deepEqual(layerMaps, [rustMapFields('merging.rs'), rustMapFields('fields.rs')])
  assert.deepEqual(
    Object.keys(layerProperties?.approximation?.properties?.maps?.properties ?? {}),
    rustMapFields('approximation.rs'),
  )
})
