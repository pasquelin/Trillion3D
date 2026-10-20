// What the temporal passes' runs in JavaScript need beyond `shaderRunBuiltins.fixture.ts`: the page
// record's terms a texel carries (`PAGE_OF_WGSL`), built by member name.
const TaaPage = (animated: number, share: number) => ({ animated, share })

export const taaBuiltins = { TaaPage }
