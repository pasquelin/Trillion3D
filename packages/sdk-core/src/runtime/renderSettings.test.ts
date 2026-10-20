import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderSettings, type RenderSettingEntry } from './renderSettings.ts'

const TABLE = {
  rays: {
    kind: 'int',
    default: 7,
    range: [1, 64],
    group: 'shadows',
    editorOnly: false,
  },
  bias: {
    kind: 'float',
    default: -1.5,
    range: [-4, 4],
    group: 'shadows',
    editorOnly: true,
  },
  level: {
    kind: 'choice',
    default: 'high',
    choices: ['low', 'high'],
    group: 'edgeSmoothing',
    editorOnly: false,
  },
  glow: {
    kind: 'flag',
    default: true,
    group: 'imageEffects',
    editorOnly: false,
  },
} as const satisfies Record<string, RenderSettingEntry>

test('with nothing written, every setting is its default', () => {
  const settings = createRenderSettings(TABLE)
  for (const name of Object.keys(TABLE) as (keyof typeof TABLE)[]) {
    assert.equal(settings.get(name), TABLE[name].default, name)
    assert.equal(settings.source(name), 'default', name)
  }
})

test('default < scene < quality < page < editor: a weaker source never overwrites a stronger one', () => {
  const settings = createRenderSettings(TABLE)
  settings.set('rays', 4, 'page')
  settings.set('rays', 2, 'quality')
  settings.set('rays', 3, 'scene')
  assert.ok(settings.holds('rays', 'scene'))
  assert.equal(settings.get('rays'), 4, 'the preset under the page value changes nothing')
  assert.equal(settings.source('rays'), 'page')
  settings.set('rays', 8, 'editor')
  assert.equal(settings.get('rays'), 8)
  settings.clear('rays', 'editor')
  assert.equal(settings.get('rays'), 4, 'the page value shows again')
  settings.clear('rays', 'page')
  assert.equal(settings.get('rays'), 2, 'then the preset value')
  settings.clear('rays', 'quality')
  assert.equal(settings.get('rays'), 3, "then the scene's value")
  assert.equal(settings.source('rays'), 'scene')
  settings.clear('rays', 'scene')
  assert.equal(settings.get('rays'), 7, 'then the default')
  assert.ok(!settings.holds('rays', 'scene'))
})

test('a hook runs once per change of the resolved value, never for a hidden write', () => {
  const settings = createRenderSettings(TABLE)
  const seen: boolean[] = []
  const remove = settings.watch('glow', (on) => void seen.push(on))
  settings.set('glow', false, 'page')
  settings.set('glow', false, 'page')
  settings.set('glow', true, 'quality')
  assert.deepEqual(seen, [false], 'the same value twice, then a weaker one: nothing more')
  settings.clear('glow', 'page')
  assert.deepEqual(seen, [false, true], 'the page value gone, the preset one shows')
  remove()
  settings.clear('glow', 'quality')
  assert.deepEqual(seen, [false, true], 'a removed hook hears nothing')
})

test('a value out of its entry is refused, and an editor setting is the editor’s alone', () => {
  const settings = createRenderSettings(TABLE)
  assert.throws(() => settings.set('rays', 0, 'page'), /RENDER_SETTING_VALUE/)
  assert.throws(() => settings.set('rays', 2.5, 'page'), /RENDER_SETTING_VALUE/)
  assert.throws(() => settings.set('glow', 1 as never, 'page'), /RENDER_SETTING_VALUE/)
  assert.throws(() => settings.set('level', 'ultra' as never, 'scene'), /RENDER_SETTING_VALUE/)
  settings.set('level', 'low', 'scene')
  assert.equal(settings.get('level'), 'low')
  assert.throws(() => settings.set('bias', 0, 'quality'), /RENDER_SETTING_EDITOR_ONLY/)
  assert.throws(() => settings.set('bias', Number.NaN, 'editor'), /RENDER_SETTING_VALUE/)
  settings.set('bias', 0.5, 'editor')
  assert.equal(settings.get('bias'), 0.5)
  assert.throws(() => settings.get('unknown' as never), /RENDER_SETTING_UNKNOWN/)
})
