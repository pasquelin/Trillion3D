// The material table's uploads among a fake device's texture writes, found by the table's own
// label (`MATERIAL_TABLE`): one lookup for every test that reads the records sent.
import { MATERIAL_TABLE } from './materialLayout.ts'
import type { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

/** The writes into the material records among `textureWrites`, in their order. */
export const materialRecordsSent = (
  textureWrites: ReturnType<typeof fakeDevice>['textureWrites'],
) =>
  textureWrites.filter(
    ({ destination }) => (destination.texture as { label?: string }).label === MATERIAL_TABLE.label,
  )
