// Shared small numeric shapes used by several correctness campaigns: a 3-component vector and a
// 3x3 matrix, both plain arrays (as the engine oracles take them), never tuples that would force a
// cast at every literal built from a loop.

export type Vec3 = number[];
export type Mat3 = number[][];
