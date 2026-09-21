// What both measurement pages (`pageEclairage.ts`, `pageThreeNu.ts`) do the same: the moving
// light on its small circle, the capture sent to Node, the bytes transferred on the network.
// Served to the page under `/mesure/` and imported by URL, with nothing from the SDK.

/** Position of the moving light at frame `frame`: a small circle walked in `period` frames. */
export function positionLampeMobile(moving, frame) {
  const angle = (frame / moving.period) * Math.PI * 2;
  return [
    moving.origin[0] + Math.cos(angle) * moving.radius,
    moving.origin[1],
    moving.origin[2] + Math.sin(angle) * moving.radius,
  ];
}

/** The RGBA capture, bottom-to-top rows, sent as-is to Node which encodes it as PNG. */
export function posterCapture(file, rgba, w, h) {
  const body = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
  return fetch(`/capture?file=${encodeURIComponent(file)}&w=${w}&h=${h}`, { method: 'POST', body });
}

/** Bytes transferred on the network since entry `depuis`, by file kind. */
export function reseauDepuis(depuis) {
  const network = {};
  for (const entry of performance.getEntriesByType('resource').slice(depuis)) {
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
export async function poseCalme(explorer, pose, limite = 64) {
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
export async function reglerReservoirs(explorer, pose, budgets) {
  if (!budgets) return null;
  const rapport = await explorer.setMemoryBudgets(budgets);
  return { ...rapport, imagesReprise: await poseCalme(explorer, pose) };
}

/**
 * Collector of engine diagnostics during a series: GPU incidents and the image pose go into
 * `lost`, published on the page; compiler warnings — a DAG that did not mount, spoken at
 * open — stay apart, for the reading.
 */
export function collecteDiagnostics(lost) {
  const diagnostics = {
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
