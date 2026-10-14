// What a write of a world material repaints in place (`worldRepaint.ts`): a texture's sampling,
// placement or picture repaints its entry with no value, and declares no surface again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts'
import { createWorldMaterials } from './worldMaterials.ts'
import { hostSurface } from './worldSurface.ts'

// A map's sampling or placement written after the entry was made repaints the entry, whose
// surfaces read the texture record itself; a new vector for the offset is heard like the one it
// replaced. Neither moves the texture's version: nothing is sent again.
test('a map’s sampling or placement repaints its entry, a new offset vector heard too', () => {
  const table = createWorldMaterials()
  const map = new Texture({ width: 2, height: 2 })
  const paint = material.meshStandard({ map })
  const entry = table.entryOf(paint)
  const writes: [() => unknown, 'sampling' | 'placement'][] = [
    [() => map.offset.set(0.5, 0), 'placement'],
    [() => (map.rotation = 1), 'placement'],
    [() => (map.wrapS = 'repeat'), 'sampling'],
    [() => (map.minFilter = 'nearest'), 'sampling'],
    [() => (map.offset = new Vector2(0.25, 0)), 'placement'],
    [() => map.offset.set(0.75, 0), 'placement'],
  ]
  for (const [write, counter] of writes) {
    const count = map[counter],
      version = map.version
    write()
    assert.equal(map[counter], count + 1, `${write}: counted as ${counter}`)
    assert.equal(map.version, version, 'no picture to send')
    assert.equal(table.entryOf(paint), entry, 'the entry kept')
    assert.deepEqual(
      table.takeRepainted(),
      [{ entry, values: false }],
      `${write}: repainted, no value`,
    )
  }
})

// A video's frame moves the picture alone: the surfaces hold the texture record, which journals
// its own write, so none is declared again; the session still checks the picture fits.
test('a picture alone declares no surface again, and the session reads it with no value', () => {
  const table = createWorldMaterials()
  const map = new Texture({ width: 2, height: 2 })
  const paint = material.meshStandard({ map })
  const entry = table.entryOf(paint)
  const surface = (entry.surfaces[0] = hostSurface(entry.material, false)),
    version = surface.version
  map.needsUpdate = true
  assert.equal(table.entryOf(paint), entry)
  const refreshed: boolean[] = []
  assert.equal(
    table.repaint(table.takeRepainted(), (values) => refreshed.push(values) > 0),
    true,
  )
  assert.deepEqual(refreshed, [false], 'read again, no value')
  assert.equal(surface.version, version, 'the surface is not declared again')
})
