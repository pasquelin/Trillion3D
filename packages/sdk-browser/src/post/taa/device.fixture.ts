import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

/** The strict minimum of a device for the temporal pass: every creation succeeds, nothing read. */
export const inertTaaDevice = () => fakeDevice().device
