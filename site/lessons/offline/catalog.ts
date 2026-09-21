import { offlineTitlesFr, offlineNotesFr } from './labels.ts';
import { engineExampleCode } from '../engine-scene/code.ts';
import { geometryRecipes } from './recipes.ts';
const fullCoverage = new Set([
  'webgl_geometry_cube',
  'webgl_geometry_extrude_shapes',
  'webgl_geometry_extrude_splines',
  'webgl_geometry_nurbs',
  'webgl_geometry_terrain',
  'webgl_buffergeometry',
  'webgl_buffergeometry_indexed',
  'webgl_buffergeometry_uint',
  'webgpu_geometry_loft',
]);
const qualifications: Record<string, string> = {
  'implicit-shell': 'Exposed voxel faces from an implicit field; this is not marching cubes.',
  'curve-control': 'A baked wave path, not an interactive spline editor.',
  sampling: 'A lower sampling density at authoring time, not mesh simplification.',
  vessel: 'An original surface of revolution, not a teapot asset.',
  lettering: 'Original block glyphs, not a font loader, outline triangulator or stroke renderer.',
  'convex-prism': 'A known convex contour, not a point-cloud convex hull algorithm.',
  refinement: 'Linear midpoint refinement, not a smoothing subdivision scheme.',
  difference: 'A bounded voxel difference, not exact triangle-mesh Boolean operations.',
  'uv-tiles': 'UV coordinates are authored and retained; the scene has no texture sampler.',
};
/** Integration data only. Rendering and controls belong to the existing shared components. */
export const offlineExamples = geometryRecipes.map((recipe) => {
  const asset = `./assets/gallery/offline/${recipe.id}/cache/native/full/manifest.json`;
  return {
    id: `offline-${recipe.id}`,
    preview: `./assets/gallery/offline/${recipe.id}/preview.png`,
    title: { en: recipe.title, fr: offlineTitlesFr[recipe.id] },
    description: {
      en:
        qualifications[recipe.id] ??
        'Original geometry authored before compilation and rendered by the public engine.',
      fr:
        offlineNotesFr[recipe.id] ??
        'Géométrie originale préparée avant compilation et affichée par le moteur public.',
    },
    category: 'geometry',
    functions: ['createExplorer'],
    status: 'ready',
    coverage: 'offline-analogue',
    referenceIds: recipe.referenceIds,
    referenceCoverage: Object.fromEntries(
      recipe.referenceIds.map((id) => [id, fullCoverage.has(id) ? 'full' : 'partial']),
    ),
    asset,
    code: engineExampleCode.replace(
      './assets/kinetic-garden/cache/native/full/manifest.json',
      asset,
    ),
    constructionCode: [
      "import { box, combine, mapPositions } from './docs/js/gallery/offline/mesh.js';",
      "import { terrain, loft, rationalPatch, sculpture, splineTube, vessel, city } from './docs/js/gallery/offline/surfaces.js';",
      "import { extrude, polygon, subdivide, voxelDifference } from './docs/js/gallery/offline/operations.js';",
      "import { lettering, paintedTerrain, splitEdges, uvTiles } from './docs/js/gallery/offline/attributes.js';",
      "import { implicitShell, verticalHit } from './docs/js/gallery/offline/implicit.js';",
      "import { writeGeometry } from './scripts/docs/gallery-geometry/write-gltf.mjs';",
      `const geometry = ${recipe.expression};`,
      `await writeGeometry('docs/assets/gallery/offline/${recipe.id}/source', geometry);`,
      `// Compile using: node scripts/docs/gallery-geometry/build.mjs ${recipe.id}`,
    ].join('\n'),
  };
});
