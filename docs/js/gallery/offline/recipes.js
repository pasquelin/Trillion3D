import { implicitShell, verticalHit } from './implicit.js';
import { lettering, paintedTerrain, splitEdges, uvTiles } from './attributes.js';
import { box, combine, mapPositions } from './mesh.js';
import { city, loft, rationalPatch, sculpture, splineTube, terrain, vessel } from './surfaces.js';
import { extrude, polygon, subdivide, voxelDifference } from './operations.js';
const recipe = (id, title, referenceIds, expression, create) => ({
  id,
  title,
  referenceIds,
  expression,
  create,
});
/** Each recipe describes authored triangles, never an undocumented runtime modifier. */
export const geometryRecipes = [
  recipe(
    'implicit-shell',
    'Two fields, one sampled shell',
    ['webgl_marchingcubes'],
    'implicitShell(18)',
    () => implicitShell(18),
  ),
  recipe(
    'terrain-hit',
    'A ray meets the authored landscape',
    ['webgl_geometry_terrain_raycast'],
    'combine([terrain(), box([0.7, verticalHit(terrain(), 0.7, 0.3) + 0.15, 0.3], [0.15, 0.3, 0.15])])',
    () =>
      combine([
        terrain(),
        box([0.7, verticalHit(terrain(), 0.7, 0.3) + 0.15, 0.3], [0.15, 0.3, 0.15]),
      ]),
  ),
  recipe(
    'curve-control',
    'Control a baked wave path',
    ['webgl_geometry_spline_editor'],
    'splineTube(0.4)',
    () => splineTube(0.4),
  ),
  recipe(
    'painted',
    'Colour follows height',
    ['webgl_geometry_colors'],
    'paintedTerrain(false)',
    () => paintedTerrain(false),
  ),
  recipe(
    'height-palette',
    'A height lookup palette',
    ['webgl_geometry_colors_lookuptable'],
    'paintedTerrain(true)',
    () => paintedTerrain(true),
  ),
  recipe(
    'hard-edges',
    'One normal per face',
    ['webgl_modifier_edgesplit'],
    'splitEdges(box())',
    () => splitEdges(box()),
  ),
  recipe(
    'lettering',
    'Two original block glyphs',
    ['webgl_geometry_text', 'webgl_geometry_text_shapes', 'webgl_geometry_text_stroke'],
    'lettering(0.25)',
    () => lettering(0.25),
  ),
  recipe('uv-tiles', 'Deterministic UV coordinates', ['webgl_random_uv'], 'uvTiles()', () =>
    uvTiles(),
  ),
  recipe(
    'sampling',
    'Sampling density before compilation',
    ['webgl_modifier_simplifier'],
    'terrain(8, 1)',
    () => terrain(8, 1),
  ),
  recipe(
    'convex-prism',
    'A convex polygonal solid',
    ['webgl_geometry_convex', 'webgl_geometry_shapes', 'webgl_geometries'],
    'extrude(polygon(5), 0.8)',
    () => extrude(polygon(5), 0.8),
  ),
  recipe('prism', 'Six faces, one solid', ['webgl_geometry_cube'], 'box()', () => box()),
  recipe(
    'contour',
    'A contour gains depth',
    ['webgl_geometry_extrude_shapes'],
    'extrude(polygon(7), 1.2)',
    () => extrude(polygon(7), 1.2),
  ),
  recipe(
    'ribbon',
    'A tube follows a wave',
    ['webgl_geometry_extrude_splines', 'webgl_modifier_curve', 'webgpu_modifier_curve'],
    'splineTube(1)',
    () => splineTube(1),
  ),
  recipe('rational-roof', 'A weighted roof', ['webgl_geometry_nurbs'], 'rationalPatch(2)', () =>
    rationalPatch(2),
  ),
  recipe('loft', 'A twisting shell', ['webgpu_geometry_loft'], 'loft(0.7)', () => loft(0.7)),
  recipe('vessel', 'A profile becomes a vessel', ['webgl_geometry_teapot'], 'vessel(1)', () =>
    vessel(1),
  ),
  recipe('terrain', 'A sampled wave landscape', ['webgl_geometry_terrain'], 'terrain(24, 1)', () =>
    terrain(24, 1),
  ),
  recipe(
    'city',
    'A deterministic skyline',
    ['webgpu_generator_city', 'webgpu_generator_building'],
    'city(5)',
    () => city(5),
  ),
  recipe(
    'sculpture',
    'A baked brush impression',
    ['webgl_sculpt', 'webgpu_sculpt'],
    'sculpture(0.5)',
    () => sculpture(0.5),
  ),
  recipe(
    'refinement',
    'Four triangles from one',
    ['webgl_modifier_subdivision', 'webgl_modifier_tessellation'],
    'subdivide(box())',
    () => subdivide(box()),
  ),
  recipe(
    'difference',
    'A tunnel through a voxel solid',
    ['webgl_geometry_csg', 'webgl_geometry_minecraft'],
    'voxelDifference(10)',
    () => voxelDifference(10),
  ),
  recipe(
    'indexed',
    'Shared vertices on a surface',
    ['webgl_buffergeometry', 'webgl_buffergeometry_indexed'],
    'terrain(12, 0.6)',
    () => terrain(12, 0.6),
  ),
  recipe(
    'wide-indices',
    'Beyond sixteen-bit vertex indices',
    ['webgl_buffergeometry_uint'],
    'terrain(256, 0.6)',
    () => terrain(256, 0.6),
  ),
  recipe(
    'bent-prism',
    'A baked nonlinear bend',
    ['webgl_modifier_curve_instanced'],
    'mapPositions(subdivide(box()), ([x,y,z]) => [x, y + x*x, z])',
    () => mapPositions(subdivide(box()), ([x, y, z]) => [x, y + x * x, z]),
  ),
];
