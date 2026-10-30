// The one decision of the toon program (`toonUnifiedOf`): lit, a toon material, the setting, and a view that shows the whole lighting; the bounced light's view is the one
// the frame draws only once the bounce program it is lent is ready (`bounceViewOf`).
import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { DirectLightResources } from '../../lighting/deferred/program.ts'
import { holdToonProfile } from '../../lighting/toon/registry.ts'
import { bounceViewOf, toonUnifiedOf } from './contractLight.ts'

function runtime({ setting = true, diagnostic = 'beauty', view = 'lit', ready = false } = {}) {
  return {
    context: { toonUnifiedDiffuse: setting },
    lights: { store: { lightingView: view } },
    gpu: { deferred: { bounceReady: () => ready } },
    run: { diagnostic },
  } as unknown as WebgpuPagesRuntime
}

const direct = {} as DirectLightResources

/** Runs `body` with one toon material held, given back at its end whatever happens: no test leaves a hold to the next. */
function withToon(body: () => void) {
  const record = { released: new Set<() => void>() }
  holdToonProfile(record, undefined, true)
  try {
    body()
  } finally {
    for (const hook of record.released) hook()
  }
}

test('no toon material, no toon program', () => {
  assert.equal(toonUnifiedOf(runtime(), true), false)
})

test('the toon program follows the setting, the lit image and the view of the whole lighting', () =>
  withToon(() => {
    assert.equal(toonUnifiedOf(runtime(), true), true)
    assert.equal(toonUnifiedOf(runtime({ setting: false }), true), false, 'the setting')
    assert.equal(toonUnifiedOf(runtime(), false), false, 'an image that is not lit')
    assert.equal(
      toonUnifiedOf(runtime({ diagnostic: 'lighting' }), true),
      true,
      'the lighting view',
    )
  }))

test('the bounced light asked: no toon program only once the bounce program is the one lent', () =>
  withToon(() => {
    const asked = { view: 'bounce' }
    assert.equal(bounceViewOf(runtime(asked), direct), false, 'the bounce program compiling')
    assert.equal(
      toonUnifiedOf(runtime(asked), true, direct),
      true,
      'toon, the view not bounced yet',
    )
    assert.equal(bounceViewOf(runtime({ ...asked, ready: true }), direct), true)
    assert.equal(toonUnifiedOf(runtime({ ...asked, ready: true }), true, direct), false, 'bounced')
    assert.equal(
      toonUnifiedOf(runtime({ ready: true }), true, direct),
      true,
      'a bounce program ready, the view not asked',
    )
  }))
