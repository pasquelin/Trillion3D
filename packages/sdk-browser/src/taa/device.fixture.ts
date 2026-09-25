import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';

/** The strict minimum of a device for the temporal pass: every creation succeeds, nothing read. */
export const inertTaaDevice = () => fakeDevice().device;
