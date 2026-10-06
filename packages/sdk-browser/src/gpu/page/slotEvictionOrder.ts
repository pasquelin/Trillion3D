/** An eviction order, its keys read one at a time as victims are taken. */
export type EvictionOrder = { readonly count: number; keyAt(at: number): string }
