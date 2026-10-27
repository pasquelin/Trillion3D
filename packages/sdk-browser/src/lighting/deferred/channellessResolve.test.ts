// A scene whose lights and objects are all in the default lighting channel is resolved by a program with no
// test of the channels in its light loop, and a scene that uses another never is: with every light and every
// surface in channel 0, the test answers yes for each pair, so the program left without it runs the full
// one's code less that statement and the read of the pixel's channels from its flags (`litPixelStatements`),
// character for character: the program that tests none unpacks none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { litPassShaders } from '../../gpu/core/shaderTexts.fixture.ts'
import { reachedFunctions } from '../../materials/texture/shaderRule.fixture.ts'
import { FULL_CONTRACT, cutsIn, keyOf } from './contractCuts.ts'

/** The test of the channels, after the reach test of the light term and the read of its record. */
const TEST = /\n if\(\(lightChannelsOf\(light\)&surfaceChannels\)==0u\)\{return [^;]*;\}/

test('the channelless program runs the full one less the test of the channels', () => {
  for (const bounce of [false, true]) {
    const full = litPassShaders(bounce, { lobeless: true })
    const channelless = litPassShaders(bounce, { lobeless: true, channelless: true })
    for (const pass of ['sun', 'local'] as const) {
      assert.match(full[pass], /\n let light=directLights\.items\[rank\];\n if\(\(lightChannelsOf/)
      assert.doesNotMatch(channelless[pass], /lightChannelsOf/)
      assert.match(full[pass], /surfaceChannels=channelsOfFlags\(surfaceFlag\);/)
      assert.doesNotMatch(channelless[pass], /channelsOfFlags|surfaceChannels/)
    }
    const ran = (code: string, entry: string) => reachedFunctions(code, [entry], {})
    const stripped = full.local
      .replace(TEST, '')
      .replace('\n surfaceChannels=channelsOfFlags(surfaceFlag);', '')
    assert.notEqual(stripped, full.local)
    assert.equal(ran(stripped, 'localMain'), ran(channelless.local, 'localMain'))
  }
})

test('the cut is a bit of the key, kept by every program but the one that leaves it out', () => {
  assert.equal(FULL_CONTRACT.channelless, false)
  const set = cutsIn({ ...FULL_CONTRACT, channelless: true })
  assert.notEqual(set, 0)
  assert.deepEqual(keyOf(false, set), { ...FULL_CONTRACT, channelless: true })
})
