// A shadow setting that changes breaks the held frame; the first reading moves the view once, an unchanged one nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { followShadowSettings } from './vsmFarShadow.ts'

test('a change of a shadow setting breaks the held frame once; an unchanged reading moves nothing', () => {
  let replaced = 0
  const view = {}
  const rt = {
    context: {} as Record<string, unknown>,
    views: { active: view },
    run: { gate: { viewReplaced: () => void replaced++ } },
  }
  followShadowSettings(rt as never)
  assert.equal(replaced, 1, 'the first reading moves the view once')
  followShadowSettings(rt as never)
  assert.equal(replaced, 1, 'an unchanged reading moves nothing')
  rt.context.shadowQuality = 0
  followShadowSettings(rt as never)
  assert.equal(replaced, 2, 'a change breaks the held frame')
})
