// Scenes specific to batch C: those batch A had no reason to visit — the paint a fixture page
// wears, and the surface record the engine reads of it.
import * as G from '../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { surfaceOf } from '../../../../packages/sdk-browser/src/page/surface.ts';

/** The paint a fixture page wears, by rank, and the surface record the engine reads of it. */
export const materiau = (index: number) =>
  G.standardSurface({ color: 0x808080 + index * 7, roughness: 0.5 });
export const porte = (d: G.GraphSurface) => ({ material: surfaceOf(d), declaration: d });
