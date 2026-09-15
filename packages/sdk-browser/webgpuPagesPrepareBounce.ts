import { BOUNCE_SETTINGS, type SceneProxy } from '../sdk-core/index.ts';
import { createGpuBounceProbes } from './gpuBounceProbes.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Ce que la capacité déclare tant que la lumière qui rebondit n'est pas gréée sur cet appareil. */
const BOUNCE_CAPABILITY = 'global illumination, surface cache and motion vectors';
/** Approximations nommées du rebond, publiées dans le diagnostic (P5). */
const BOUNCE_APPROXIMATIONS = [
  'the probe grid interpolates irradiance between eight probes, so a detail smaller than a cell is lost',
  'probe visibility uses six mean distances per probe, not a full distance map',
  'the resident proxy carries a certified geometric error, so a bounce leaves the coarse surface',
  'the proxy carries diffuse albedo only: emission, transparency and specular are not bounced',
  'a probe update reads the grid as it stands, so one update may see a neighbour already updated',
  'a ray that exhausts the published traversal bound reports no hit, which darkens rather than leaks',
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
  if (!bounce.wanted) bounce.reason = 'the host turned the bounce off';
  else if (!context.readSceneProxy)
    bounce.reason = 'the cache carries no resident proxy; recompile it with this compiler';
  else if (!lights.buffer) bounce.reason = 'the declared-light buffer is unavailable';
  if (bounce.reason) {
    publish(rt);
    return;
  }
  bounce.pending = context.readSceneProxy!()
    .then((proxy: SceneProxy) => createGpuBounceProbes(device, proxy, lights.buffer!))
    .then(
      (probes) => {
        bounce.probes = probes;
        rt.capabilities.unsupported = rt.capabilities.unsupported.filter(
          (item) => item !== BOUNCE_CAPABILITY,
        );
        publish(rt);
      },
      (error: unknown) => {
        bounce.reason = `resident proxy unavailable: ${String(error)}`;
        rt.diag.diagnosticFailure('bounce-proxy-unavailable', error);
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
    probeCounts: probes?.grid.counts ?? null,
    probeSpacing: probes?.grid.spacing ?? null,
    probes: probes?.grid.probes ?? null,
    raysPerFrame: probes
      ? Math.min(BOUNCE_SETTINGS.probesPerFrame, probes.grid.probes) * BOUNCE_SETTINGS.raysPerProbe
      : null,
    sweepFrames: probes?.sweepFrames ?? null,
    unavailable: bounce.reason,
    approximations: BOUNCE_APPROXIMATIONS,
  });
}
