// Published figures of the reference, as `docs/REFERENCE_UE5.md` cites them, put next to
// the campaign readings. Nothing else than that document: a quantity without a published
// figure says "unpublished", and a comparison that is not honest (different machine, scene,
// resolution) says so in its "reading" column.
import { nombre, octets, tableau } from './rapportGlobalGraphes.mjs';
import { OCTETS_PAR_TRIANGLE, sommePasses, UNREAL, visibilite } from './rapportGlobalChiffres.mjs';

/**
 * The "the reference / us" table. `mobile` is the campaign reading at full resolution in
 * the ground view, `fixe` the same at a still camera. The reference milliseconds are those
 * of its console demo, not of this machine: the "reading" column reminds that on every row.
 */
export function tableauReference({ mobile, fixe, instances12 }) {
  const cpu = mobile?.cpuP50 ?? null;
  const lignes = [
    [
      'Triangles per cluster',
      String(UNREAL.trianglesParGrappe),
      String(UNREAL.trianglesParGrappe),
      'identical (constant checked by the test)',
    ],
    [
      'Clusters per group',
      UNREAL.grappesParGroupe.join(' to '),
      UNREAL.grappesParGroupe.join(' to '),
      'identical; the floor of 8 is not applied (Geometry 16)',
    ],
    [
      'Streaming page',
      `${UNREAL.pageKio} KiB (secondary source)`,
      `${UNREAL.pageKio} KiB`,
      'identical',
    ],
    [
      'Residency budget',
      `${UNREAL.poolMo} MB, root pages pinned`,
      mobile
        ? `${nombre(mobile.pagesDemandees, 0)} pages requested, ${nombre(mobile.pagesResidentes, 0)} resident, ${octets(mobile.geometrieOctets)}`
        : 'not measured',
      'counted in pages on our side, in bytes on theirs',
    ],
    [
      'Geometry in memory',
      `${nombre(UNREAL.octetsParTriangle, 1)} bytes per triangle`,
      `~${OCTETS_PAR_TRIANGLE.nous} bytes per triangle (docs/FORMAT.md, not measured here)`,
      'the bench publishes resident bytes, not bytes per triangle: ~6× above per the doc',
    ],
    [
      'Triangles rasterized per frame',
      `${nombre(UNREAL.trianglesParImage / 1e6, 0)} M regardless of scene`,
      mobile ? nombre(mobile.triangles, 0) : 'not measured',
      'our count follows the scene and requested quality, theirs is fixed',
    ],
    [
      'CPU cost per frame',
      '“almost zero”',
      nombre(cpu, 2, 'ms'),
      'the only millisecond that compares across machines',
    ],
    [
      'Visibility buffer (GPU)',
      `~${nombre(UNREAL.visibiliteMs, 1)} ms (PS5, 2496×1404)`,
      nombre(sommePasses(mobile, visibilite), 2, 'ms'),
      'same resolution, different machine: profile shape, not a verdict',
    ],
    [
      'Materials pass (GPU)',
      `~${nombre(UNREAL.materiauxMs, 1)} ms (Emit GBuffer)`,
      nombre(mobile?.passe('WG material surfaces v1')?.p50 ?? null, 2, 'ms'),
      'same caveat',
    ],
    [
      'Draw calls',
      'one per material',
      mobile ? nombre(mobile.appelsDeDessin, 0) : 'not measured',
      'one for exact clusters; one per item and face for blend',
    ],
    [
      'Work in a still scene',
      'none',
      fixe
        ? fixe.gpuReleves === 0 && fixe.imageTenue
          ? 'no GPU pass: frame held'
          : `${fixe.gpuReleves} GPU samples`
        : 'not measured',
      fixe ? `CPU ${nombre(fixe.cpuP50, 2, 'ms')} per frame at a locked camera` : '',
    ],
    [
      'Temporal antialiasing',
      'not published (rendered at 2496×1404, upscaled to 4K)',
      nombre(mobile?.passe('WG temporal antialiasing')?.p50 ?? null, 2, 'ms'),
      'native resolution, no upscale',
    ],
    [
      'Instances',
      'one record per cluster, instance as an index',
      instances12
        ? `12 copies: ${octets(instances12.geometrieOctets)} of geometry`
        : 'not measured',
      'twelve copies of the clusters (Geometry 5)',
    ],
    [
      'Textures',
      'fixed physical pool, compressed at cook time (unsourced)',
      mobile
        ? `${octets(mobile.texturesEngagees)} committed on ${octets(mobile.texturesPool)} of raw RGBA pool`
        : 'not measured',
      'neither a fixed pool nor compression (Textures T4, T5)',
    ],
    [
      'Materials on the virtualized path',
      'opaque and masked only',
      'opaque, masked and blend',
      'blend costs one call per item and face (Compiler 10)',
    ],
  ];
  return tableau(
    ['Quantity', 'The reference', 'Us (this campaign)', 'Reading'],
    lignes,
    'reference',
  );
}

/** The reference profile per pass, next to ours, for the SHAPE of the profile. */
export function tableauProfilReference(mobile) {
  const nous = (test) =>
    nombre(
      sommePasses(mobile, (p) => test(p.name)),
      3,
      'ms',
    );
  const lignes = [
    ['Clear VisBuffer', '0.066', nous((n) => n === 'WG clear')],
    [
      'InstanceCull + ClusterCull',
      '0.514',
      nous((n) => /^WG (DAG selection|draw compaction|partition)$/.test(n)),
    ],
    [
      'Rasterize (hardware + compute)',
      '1.148',
      nous((n) => /^WG (visibility|raster |small triangle|hybrid)/.test(n)),
    ],
    ['BuildHZB', '0.099', nous((n) => n.startsWith('WG HiZ'))],
    ['Post Pass (2nd occlusion pass)', '0.410', nous((n) => n === 'WG visibility secondary')],
    [
      'Emit GBuffer / materials pass',
      '2.084',
      nous((n) => /^WG (material surfaces|empty surfaces)/.test(n)),
    ],
    [
      'Shadows (virtual shadow maps)',
      'not published in that talk',
      nous((n) => /^WG shadow/.test(n)),
    ],
    [
      'Deferred lighting',
      'not published in that talk',
      nous((n) => /^WG (deferred lighting|light tiles)/.test(n)),
    ],
    ['Temporal antialiasing', 'not published', nous((n) => n === 'WG temporal antialiasing')],
    ['Present', 'not published', nous((n) => /^WG (HDR composition|direct present)/.test(n))],
  ];
  return tableau(
    ['Pass', 'Reference, ms (PS5, 2496×1404 → 4K)', 'Us, ms p50 (street view, 2496×1404)'],
    lignes,
  );
}
