/**
 * The open world's prop kit (#332): shapes, placement and surfaces every region builds from.
 *
 * - Shapes stand on y = 0, centred on +Y (`sphere`, `torus` are centred on the origin):
 *   `box`, `plane`, `quads`, `roofPrism`, `extrude` (flat faces); `roundedBox`, `bevelExtrude`
 *   (bevelled); `lathe`, `cylinder`, `cone`, `sphere`, `torus`, `tube`, `loft` (smooth sides);
 *   `sheet` (a parametric surface); `truss`, `bar` (lattice steel); `hull` (a ship).
 * - `transform(part, { at, yaw, pitch, roll, scale })` or a column-major matrix moves a part;
 *   `merge` groups parts by surface; `prop(id, parts)` makes the shared `PropMesh`.
 * - `flatShade` gives hard edges, `weld` smooths seams, `deform` moves vertices; `fractalNoise`,
 *   `hash01`, `jitter` are stateless seeded noise; `blob` a noise-displaced rock.
 * - `grow(rule, seed)` branches a plant; `wood` and `foliage` mesh it; `blade` is one leaf.
 * - `SURFACES` is the shared palette; `surface`, `glow`, `paint`, `card` make new ones. Only
 *   `card/…` surfaces (leaves, sails, fronds) and non-opaque ones are written double-sided.
 * - `sharedProps(seed)` builds every shared prop; `placeLamps` turns a prop's lamps into world
 *   lights for one instance. `propProblems(prop)` checks a prop in a test.
 * - `forestStands(seed)` builds the forest patches (`tree-stand-<biome>-<k>`, part of the shared
 *   props): a square of closed stand merged into one mesh, one variant per ground gradient.
 * - `VEHICLE_SPECS` are the vehicles as data (parametric parts and anchors), `vehicleProps`
 *   the same vehicles as props.
 */
export { deform, flatShade, meshPart, partBounds, triangleCount } from './geometry.ts';
export { box, extrude, plane, quads, roofPrism, sheet } from './shapes.ts';
export { cone, cylinder, lathe, sphere, torus, tube, type ProfilePoint } from './round.ts';
export { applyPoint, merge, prop, transform, trsMatrix, type Trs } from './transform.ts';
export { card, glow, isDoubleSided, surface, SURFACES } from './surfaces.ts';
export { triangulate, type Point2 } from './triangulate.ts';
export { between, hash01, jitter } from './noise.ts';
export { blob } from './organic.ts';
export { sharedProps } from './catalog.ts';
export { placeLamps, STREET_LAMP_LIGHTS, type PropLamp } from './lamps.ts';
export { WIND_TURBINE } from './industry.ts';
export { hull } from './hull.ts';
export { bevelExtrude, roundedBox } from './smooth.ts';
export { foliage, grow, wood, type GrowthRule } from './branches.ts';
export { fractalNoise, valueNoise } from './noise.ts';
export { propProblems } from './validate.ts';
export { tree } from './trees.ts';
export {
  forestStands,
  STAND_SIDE,
  standExtent,
  standTolerance,
  type StandBiome,
  type StandVariant,
} from './stands.ts';
export { VEHICLE_SPECS, vehicleProps } from './vehicles.ts';
export { partMeshes, vehicleProp } from './vehicle-parts.ts';
