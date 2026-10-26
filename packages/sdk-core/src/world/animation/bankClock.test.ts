// The clock of the animation banks (`bankClock.ts`): a track is as long as its bake's frames less
// one over the bake's own rate.
import test from 'node:test'
import type { BankItem, DecodedBanks } from '../../scene/core/animationBanks.ts'
import { advanceBankClocks, createBankClock } from './bankClock.ts'
import type { Object3D } from '../object/object3d.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'

const item = (bake: number, position: number): BankItem => ({
  bake,
  looping: true,
  position,
  playRate: 1,
  minScreenSize: 0,
  bounds: new Float64Array(6),
  mesh: 0,
})
const bake = (frames: number, rate: number) => ({
  joints: 1,
  frames,
  inverseAt: 0,
  keysAt: 12,
  rate,
})

test('a looping track wraps at its bake’s frames less one over its rate, whatever the other bakes’ rates', () => {
  const banks: DecodedBanks = {
    bakes: [bake(25, 24), bake(25, 30)],
    items: [item(0, 0.75), item(1, 0.75)],
    pool: new Float32Array(0),
  }
  const clock = createBankClock(banks)
  const owner = { parent: null } as unknown as Object3D
  clock.own(owner)
  advanceBankClocks(owner, 0.5)
  advanceBankClocks(owner, 0)
  near([...clock.time], [0.25, 0.45], 'the second wrapped into 1 s at 24, into 0.8 s at 30', 1e-12)
})
