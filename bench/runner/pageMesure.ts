// What both measurement pages (`pageEclairage.ts`, `pageThreeNu.ts`) do the same: the moving
// light on its small circle, the capture sent to Node, the bytes transferred on the network.
// Served to the page under `/mesure/` and imported by URL, with nothing from the SDK.
import type { MeasuredWorld } from '../../packages/sdk-browser/src/measurement/measurement.ts';
import type { CameraPose } from '../../packages/sdk-core/src/index.ts';
import type { BackendDiagnostic } from '../../packages/sdk-browser/src/backend/types.ts';
import type { MemoryBudgets } from '../../packages/sdk-browser/src/measurement/measurement.ts';
import type { ReglageVivant, Reseau } from './report/types.ts';
import type { FrameMetrics } from '../../packages/sdk-core/src/index.ts';

interface MovingLight {
  origin: readonly number[];
  radius: number;
  period: number;
}

/** Position of the moving light at frame `frame`: a small circle walked in `period` frames. */
export function positionLampeMobile(moving: MovingLight, frame: number): [number, number, number] {
  const angle = (frame / moving.period) * Math.PI * 2;
  return [
    moving.origin[0] + Math.cos(angle) * moving.radius,
    moving.origin[1],
    moving.origin[2] + Math.sin(angle) * moving.radius,
  ];
}

/** The RGBA capture, bottom-to-top rows, sent as-is to Node which encodes it as PNG. */
export function posterCapture(file: string, rgba: Uint8Array, w: number, h: number) {
  const body = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer;
  return fetch(`/capture?file=${encodeURIComponent(file)}&w=${w}&h=${h}`, { method: 'POST', body });
}

/** Bytes transferred on the network since entry `depuis`, by file kind. */
export function reseauDepuis(depuis: number): Reseau {
  const network: Reseau = {};
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  for (const entry of entries.slice(depuis)) {
    const extension = entry.name.split('?')[0].match(/\.([a-z0-9]+)$/i);
    const kind = (extension ? extension[1] : 'autre').toLowerCase();
    network[kind] = (network[kind] ?? 0) + (entry.transferSize || entry.encodedBodySize || 0);
  }
  return network;
}

/**
 * Renders the pose until the engine holds it — temporal accumulation converged, nothing in
 * flight — at most `limite` frames. A capture taken mid-accumulation would carry the history of
 * the trajectory, whose texture-tile arrivals do not replay identically from one run to
 * another; a held pose's capture depends only on the pose. Returns how many frames it took,
 * or `null` if the engine holds no image (the Three witness, for example).
 */
export async function poseCalme(
  explorer: MeasuredWorld,
  pose: CameraPose,
  limite = 64,
): Promise<number | null> {
  for (let i = 0; i < limite; i++) {
    const frame = explorer.render(pose);
    await explorer.flush();
    if (typeof frame.frameHeld !== 'boolean') return null;
    if (frame.frameHeld) return i;
  }
  return null;
}

/**
 * In-session reservoir tuning — what an application slider does — and what it costs: the
 * engine report (held reservoirs, evicted pages and tiles, milliseconds of the tuning) and
 * the number of frames until the pose holds again. `null` with no tuning requested.
 */
export async function reglerReservoirs(
  explorer: MeasuredWorld,
  pose: CameraPose,
  budgets: { geometryPoolBytes?: number | null; texturePoolBytes?: number | null } | null,
): Promise<ReglageVivant | null> {
  if (!budgets) return null;
  const requested: MemoryBudgets = {
    geometryPoolBytes: budgets.geometryPoolBytes ?? undefined,
    texturePoolBytes: budgets.texturePoolBytes ?? undefined,
  };
  const rapport = await explorer.setMemoryBudgets(requested);
  return { ...rapport, imagesReprise: await poseCalme(explorer, pose) };
}

/**
 * Collector of engine diagnostics during a series: GPU incidents and the image pose go into
 * `lost`, published on the page; compiler warnings — a DAG that did not mount, spoken at
 * open — stay apart, for the reading.
 */
export function collecteDiagnostics(lost: string[]) {
  const diagnostics: { avertissements: unknown; onDiagnostic: (event: BackendDiagnostic) => void } =
    {
      avertissements: null,
      onDiagnostic(event) {
        // What the barrier did to hold the image, and what still prevents it: the cause of a
        // noisy A/A witness is read here, not in the noise.
        if (event.phase === 'pose-settle')
          lost.push(`${event.phase} ${JSON.stringify(event.context)}`);
        if (event.phase === 'dag-warnings') diagnostics.avertissements = event.context;
        if (event.phase !== 'gpu-device-lost') return;
        const cause = event.context ?? {};
        lost.push(`${event.phase} : ${cause.reason ?? ''} ${cause.message ?? ''}`);
      },
    };
  return diagnostics;
}

/**
 * Measurements from the last reading, `null` included: a dropped measurement would be
 * indistinguishable from an absent one, which a reader would replace with zero — which the
 * contract forbids. A bytes-per-label reading is a table of numbers: it passes too.
 */
export function filtrerMetriques(
  last: Partial<FrameMetrics> | null,
): Partial<FrameMetrics> & Record<string, unknown> {
  const scalaire = (v: unknown) => v === null || ['number', 'boolean', 'string'].includes(typeof v);
  const table = (v: unknown) =>
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'number');
  return Object.fromEntries(
    Object.entries(last ?? {}).filter(([, v]) => scalaire(v) || table(v)),
  ) as Partial<FrameMetrics> & Record<string, unknown>;
}

/**
 * Drains the shadow-page queue before reading the atlas: a pending page still holds the
 * previous depth, and the fingerprint would prove nothing. The loop is bounded, and the
 * remaining count is published as-is, never assumed zero.
 */
export async function drainShadowAtlas(explorer: MeasuredWorld, capturePose: CameraPose) {
  if (typeof explorer.shadowAtlasDigest !== 'function') return null;
  let pending: number | null = null,
    drains = 0;
  for (; drains < 600; drains++) {
    const frame = explorer.render(capturePose);
    await explorer.flush();
    pending = typeof frame.shadowPagesPending === 'number' ? frame.shadowPagesPending : null;
    if (pending === null || pending === 0) break;
  }
  const digest = await explorer.shadowAtlasDigest();
  return digest ? { ...digest, pagesEnAttente: pending, images: drains } : null;
}
