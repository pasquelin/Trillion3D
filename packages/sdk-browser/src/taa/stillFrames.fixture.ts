// The still frames before a frame drawn at the display's size can be held, as the engine counts
// them for its jitter cycle (`taaStillFrames`), one copy for every test.
import { TAA_SAMPLES, taaStillFrames } from './jitter.ts';

export const TAA_STILL_FRAMES = taaStillFrames(TAA_SAMPLES);
