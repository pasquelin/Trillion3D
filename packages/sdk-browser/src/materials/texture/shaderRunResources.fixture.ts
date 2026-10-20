// What a shader reaches through `shaderRun` (`shaderRun.fixture.ts`) beyond its values: the
// pointer `&x` gives an atomic, the atomics on it, and the textures its scope binds.

/** A pointer: what `&x` gives an atomic (`shaderRun.fixture.ts`). */
type Ref = { get: () => number; set: (value: number) => void }
const swap = (p: Ref, value: number) => {
  const old = p.get()
  p.set(value)
  return old
}

export const resources = {
  $ref: (get: Ref['get'], set: Ref['set']): Ref => ({ get, set }),
  $deref: (p: Ref) => p.get(),
  atomicAdd: (p: Ref, value: number) => swap(p, p.get() + value),
  atomicMax: (p: Ref, value: number) => swap(p, Math.max(p.get(), value)),
  atomicLoad: (p: Ref) => p.get(),
  atomicStore: (p: Ref, value: number) => void p.set(value),
  atomicExchange: swap,
  atomicOr: (p: Ref, value: number) => swap(p, (p.get() | value) >>> 0),
  atomicAnd: (p: Ref, value: number) => swap(p, (p.get() & value) >>> 0),
  // A texture the scope binds answers its own loads: a record table's words
  // (`../../gpu/core/recordTexture.fixture.ts`).
  textureLoad: (
    texture: { load(coords: number[], layer: number): number[] },
    coords: number[],
    layer: number,
  ) => texture.load(coords, layer),
  // The layers a bound array texture holds: its own (`layers`).
  textureNumLayers: (texture: { layers: number }) => texture.layers,
  textureStore: (
    texture: { store(coords: number[], layer: number, value: number[]): void },
    coords: number[],
    layer: number,
    value: number[],
  ) => texture.store(coords, layer, value),
}
