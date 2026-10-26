// The tone cube is admitted by the device's budget like the other views' optional resources: a setting of any size under a small
// budget draws with the largest cube the room holds, says why in the frame's metrics, and is counted in what the view holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals } from '../../../../tests/kit/fakeDevice/globals.ts'
import {
  COLOR_GRADING_RULES,
  type ColorGradingValues,
} from '../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { resolveSettings } from '../../../sdk-core/src/contracts/settingRules.ts'
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { installGpuDeviceLedger } from '../gpu/core/deviceLedger.ts'
import { destroyRetired } from '../gpu/core/frameRetire.ts'
import { toneBakeShader, toneTableFormat } from './toneBakeWgsl.ts'
import { askToneBake, createToneLut, toneTableMetrics } from './toneLut.ts'
import { pipelinesSettled } from './deferred/compileLedger.ts'

installGpuGlobals()

const values = (settings: object) =>
  resolveSettings(COLOR_GRADING_RULES, settings) as ColorGradingValues
const rank = TONE_MAPPING_RANK.filmic

test('a cube too large for the budget is made at the largest side the room holds, and says why; no cap on the setting', async () => {
  const { device } = fakeDevice({ limits: { maxTextureDimension3D: 4096 } })
  let limit = 1e12
  const ledger = installGpuDeviceLedger(device, { limit: () => limit })
  const lut = createToneLut(device)
  askToneBake(device)
  await pipelinesSettled(device)
  const encoder = device.createCommandEncoder()
  // Without a limit the setting is the side, whatever it is (here a megabyte of texels short of the device's).
  assert.equal(lut.encode(encoder, values({ lutSize: 48 }), rank), true)
  assert.equal(lut.side, 48)
  assert.equal(lut.why, undefined)
  // A budget that holds 40 texels a side beside what the view has: the cube asked for is the largest that fits, not a refusal.
  limit = ledger.bytes - lut.bytes + 40 ** 3 * 8 + 512
  assert.equal(lut.encode(encoder, values({ lutSize: 1024 }), rank), true)
  assert.equal(lut.side, 40)
  assert.equal(lut.bytes, 40 ** 3 * 8)
  assert.match(lut.why ?? '', /room for 40 texels a side of the tone table, not 1024/)
  assert.deepEqual(toneTableMetrics(lut), { side: 40, bytes: 40 ** 3 * 8, why: lut.why })
  destroyRetired(device)
  assert.ok(
    ledger.bytes <= limit,
    'the ledger holds the cube it admitted, the first one given back',
  )
  // The room back: the next change of the settings asks the size again and the reason goes.
  limit = 1e12
  assert.equal(lut.encode(encoder, values({ lutSize: 64 }), rank), true)
  assert.equal(lut.side, 64)
  assert.equal(lut.why, undefined)
  assert.equal(toneTableMetrics(lut)?.why, null)
})

test('a budget that leaves no room for the cube makes the least one, which a lit image cannot do without', async () => {
  const { device } = fakeDevice()
  let limit = 1e12
  installGpuDeviceLedger(device, { limit: () => limit })
  const lut = createToneLut(device)
  askToneBake(device)
  await pipelinesSettled(device)
  const encoder = device.createCommandEncoder()
  lut.encode(encoder, values({}), rank)
  assert.equal(lut.side, 32)
  // Asked for a size the room cannot hold, with no room even for the least cube: the first cube is given back, the least is
  // made as any resource a lit image cannot do without, and the budget refuses it, as it refuses the session.
  limit = 1
  assert.throws(() => lut.encode(encoder, values({ lutSize: 33 }), rank), /budget|memory/i)
})

test('a tone cube the device cannot make larger than its 3D textures is held to them', async () => {
  const { device } = fakeDevice({ limits: { maxTextureDimension3D: 24 } })
  const lut = createToneLut(device)
  askToneBake(device)
  await pipelinesSettled(device)
  lut.encode(device.createCommandEncoder(), values({ lutSize: 64 }), rank)
  assert.equal(lut.side, 24)
  assert.equal(toneTableMetrics(createToneLut(device)), undefined, 'no cube, no metric')
})

test('the tone cube holds ten bits a channel: packed where the device stores to it, else cut to ten bits by the baking', () => {
  const features = (...names: string[]) => new Set(names)
  assert.equal(toneTableFormat(features('texture-formats-tier1')), 'rgb10a2unorm')
  assert.equal(toneTableFormat(features()), 'rgba16float')
  const packed = toneBakeShader('rgb10a2unorm')
  assert.match(packed, /^requires texture_formats_tier1;/)
  assert.match(packed, /texture_storage_3d<rgb10a2unorm,write>/)
  assert.doesNotMatch(packed, /1023\.0/, 'the format cuts the colour itself')
  const core = toneBakeShader('rgba16float')
  assert.doesNotMatch(core, /requires/)
  assert.match(core, /texture_storage_3d<rgba16float,write>/)
  assert.match(core, /round\(tableColor\(bake,vec3f\(id\)\*bake\.lattice\.x\)\*1023\.0\)\/1023\.0/)
})
