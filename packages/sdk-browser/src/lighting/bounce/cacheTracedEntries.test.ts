// The own group of the radiance cache's trace through the triangles names exactly what the layout of its kernels declares: the marks texture belongs to the kernels that write it, whatever atlas they are given.

import test from 'node:test'
import assert from 'node:assert/strict'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'
import { cacheTracedEntries, type CacheWiring, type Queued } from './cache/cacheGroups.ts'
import { cacheTracedLayouts } from './cache/cacheBindings.ts'
import type { CacheStorage, TraceAtlas } from './cache/cacheStorage.ts'
import type { SceneRays } from '../surfaceCache/lighting/surfaceLighting.ts'

/** A stand-in that answers every property with another stand-in: the entries only carry the resources through. */
const anything = (): never => new Proxy<object>(function () {}, { get: () => anything() }) as never

const bindings = (entries: readonly { binding: number }[]) =>
  entries.map((entry) => entry.binding).sort((a, b) => a - b)

const entriesFor = (hitLit: boolean, marked: boolean) =>
  cacheTracedEntries(
    anything() as CacheWiring,
    { hitLit },
    anything() as CacheStorage,
    anything() as Queued,
    anything() as SceneRays,
    { view: {}, marks: marked ? {} : undefined } as unknown as TraceAtlas,
  )

test('the kernels that mark the hits are bound with the marks texture, the others without it, whatever the atlas holds', () => {
  for (const hitLit of [false, true])
    for (const marked of [false, true]) {
      if (hitLit && !marked) continue
      const layout = cacheTracedLayouts(WORD_LIGHT_FORMAT, hitLit)[0]
      assert.deepEqual(
        bindings(entriesFor(hitLit, marked)),
        bindings(layout.map((entry) => ({ binding: entry.binding }))),
        `kernels marking: ${hitLit}, atlas marked: ${marked}`,
      )
    }
})
