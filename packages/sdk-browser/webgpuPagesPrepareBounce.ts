import { BOUNCE_SETTINGS, PROBE_FLOATS, type SceneProxy } from '../sdk-core/index.ts';
import { createGpuBounceProbes } from './gpuBounceProbes.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Ce que la capacité déclare tant que la lumière qui rebondit n'est pas gréée sur cet appareil. */
const BOUNCE_CAPABILITY = 'global illumination, surface cache and motion vectors';
/** Approximations nommées du rebond, publiées dans le diagnostic (P5). */
const BOUNCE_APPROXIMATIONS = [
  'the cascades interpolate irradiance between eight probes, so a detail smaller than a cell is lost',
  'order-2 spherical harmonics carry the irradiance, so a sharp directional change is smoothed',
  'probe visibility uses six mean distances per probe, not a full distance map',
  'the resident proxy carries a certified geometric error, so a bounce leaves the coarse surface',
  'the proxy carries diffuse albedo only: emission, transparency and specular are not bounced',
  'a probe update reads the cascades as they stand, so one update may see a neighbour already updated',
  'a probe ray that exhausts the published traversal bound reports no hit, which darkens',
  'a shadow ray that exhausts that bound reports no blocker, which lights a cell that should be dark',
  'the surface cache holds one radiance per proxy triangle and face, so lighting is constant over a cell',
  'the surface cache is swept on a budget, so a freshly moved light reaches a cell within one sweep',
  'a probe buried in a surface or lost in open sky goes to sleep and is skipped until a light changes',
  'the millisecond budget follows a timestamp read several frames late, and only every third or twelfth frame',
  'a point no cascade level reaches gets exactly zero bounce, never a guess',
];

/**
 * Grée la lumière qui rebondit, à la première image qui porte une lampe déclarée.
 *
 * Rien n'est chargé avant : une scène sans lampe n'a rien à faire rebondir, et l'objet de cache du
 * proxy pèse des dizaines de mégaoctets qui retarderaient sa première image pour rien. Une fois
 * qu'il arrive, le proxy monte en mémoire graphique en entier et la grille de sondes est allouée
 * sur son emprise — indépendante de la caméra, comme le proxy lui-même (LC1).
 *
 * Tout est facultatif : un cache sans proxy, un appareil qui refuse la passe ou un hôte qui n'en
 * veut pas gardent une image correcte et une capacité manquante déclarée. Rien n'est jeté en silence.
 */
export function ensureBounce(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { bounce, lights, context } = rt;
  if (bounce.probes || bounce.pending || bounce.reason) return;
  if (!bounce.wanted)
    bounce.reason = 'the bounce is off by default; create the explorer with bounce: true';
  else if (!context.readSceneProxy)
    bounce.reason = 'the cache carries no resident proxy; recompile it with this compiler';
  else if (!lights.buffer) bounce.reason = 'the declared-light buffer is unavailable';
  if (bounce.reason) {
    publish(rt);
    return;
  }
  bounce.pending = context.readSceneProxy!()
    .then((proxy: SceneProxy) =>
      createGpuBounceProbes(device, proxy, lights.buffer!, bounce.budgetMs),
    )
    .then(
      (probes) => {
        bounce.probes = probes;
        rt.capabilities.unsupported = rt.capabilities.unsupported.filter(
          (item) => item !== BOUNCE_CAPABILITY,
        );
        publish(rt);
      },
      (error: unknown) => {
        // Le proxy absent n'est plus la seule cause : un appareil trop petit pour les liaisons du
        // rebond refuse ici aussi, et le message porte la liaison et les octets qui ont manqué.
        bounce.reason = `bounce unavailable: ${String(error)}`;
        rt.diag.diagnosticFailure('bounce-unavailable', error);
        publish(rt);
      },
    );
}

/** Ce que le rebond a réellement obtenu : taille du proxy, grille, budget. Jamais une estimation. */
function publish(rt: WebgpuPagesRuntime) {
  const { bounce, diag } = rt,
    probes = bounce.probes;
  diag.engineDiagnostic('bounce-lighting', 'Lumière qui rebondit gréée', {
    version: 1,
    settings: { ...BOUNCE_SETTINGS },
    proxyTriangles: probes?.proxy.triangleCount ?? null,
    proxyNodes: probes?.proxy.nodeCount ?? null,
    proxyBytes: probes?.proxy.bytes ?? null,
    proxyErrorMetres: probes?.proxy.errorMetres ?? null,
    proxyCellMetres: probes?.proxy.cellMetres ?? null,
    surfaceTexels: probes?.surface.texels ?? null,
    surfaceBytes: probes?.surface.bytes ?? null,
    surfaceSweepFrames: probes?.surface.sweepFrames ?? null,
    cascadeLevels: probes?.cascades.levels.length ?? null,
    cascadeSize: probes?.cascades.size ?? null,
    cascadeSpacings: probes?.cascades.levels.map((level) => level.spacing) ?? null,
    probes: probes?.cascades.probes ?? null,
    // Ce que la carte d'occupation retient : les mailles du niveau le plus fin qui touchent de la
    // géométrie, sur toutes celles de l'emprise, et ce que la carte coûte en mémoire.
    occupiedCells: probes?.occupancy.marked ?? null,
    mapCells: probes?.occupancy.cells ?? null,
    mapBytes: probes?.occupancy.bytes ?? null,
    probeBytes: probes ? probes.cascades.probes * PROBE_FLOATS * 4 : null,
    // La cible, la fraction que l'asservissement tient, et la dernière durée qu'il a vue.
    budgetMs: probes?.budget.budgetMs ?? bounce.budgetMs,
    budgetLoad: probes?.budget.load ?? null,
    budgetLastMs: probes?.budget.lastMs ?? null,
    budgetSamples: probes?.budget.samples ?? null,
    sweepFrames: probes?.sweepFrames ?? null,
    unavailable: bounce.reason,
    approximations: BOUNCE_APPROXIMATIONS,
  });
}
