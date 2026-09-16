import { adaptivePixelError } from '../sdk-core/index.ts';
import type { CameraMotion, EngineCamera } from './cameraWorld.ts';

export function resolvePixelError(
  context: { pixelError?: number; lodAdaptive?: boolean },
  cam: EngineCamera,
  motion: CameraMotion,
) {
  const base = context.pixelError ?? 0;
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  // La vitesse est celle de l'œil dans le monde : un rig qui emporte la caméra la déplace aussi.
  // La position vient de la caméra du moteur, ancêtres résolus par l'entrée d'image.
  const eye = cam.position;
  let speed = 0;
  if (motion.last && motion.lastMs != null) {
    const dt = Math.max((now - motion.lastMs) / 1000, 1e-4);
    const dx = eye[0] - motion.last[0],
      dy = eye[1] - motion.last[1],
      dz = eye[2] - motion.last[2];
    speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
  }
  if (!motion.last) motion.last = new Float64Array(3);
  motion.last.set(eye);
  motion.lastMs = now;
  if (!context.lodAdaptive || !(base > 0)) return base;
  return adaptivePixelError(base, speed, Math.max(cam.far * 0.05, 1));
}
/** The request key of a record: its streaming bundle when the cache has one, its own page otherwise. */
export function pageRequestUrl<T extends { url: string; streamUrl?: string }>(rec: T) {
  return rec.streamUrl ?? rec.url;
}
/** Numérote les clés de requête distinctes une fois pour toutes ; renvoie leur nombre. */
export function indexPageRequests<
  T extends { url: string; streamUrl?: string; requestIndex?: number },
>(pages: readonly T[]) {
  const byKey = new Map<string, number>();
  for (let i = 0; i < pages.length; i++) {
    const key = pageRequestUrl(pages[i]);
    let rank = byKey.get(key);
    if (rank === undefined) {
      rank = byKey.size;
      byKey.set(key, rank);
    }
    pages[i].requestIndex = rank;
  }
  return byKey.size;
}
/**
 * Dédoublonnage des clés de requête sans table de hachage : une estampille par rang, réutilisée d'une
 * image à l'autre. Une coupe de quinze mille pages est parcourue sans allouer ni hacher.
 */
export class RequestStamps {
  private stamps: Int32Array;
  private current = 0;
  constructor(count: number) {
    this.stamps = new Int32Array(Math.max(0, count));
  }
  /** Ouvre un passage : tout ce qui a été vu avant est oublié. */
  begin() {
    this.current++;
  }
  /** Vrai la première fois que ce rang est vu depuis `begin()`. Un rang inconnu n'est jamais filtré. */
  first(index: number | undefined) {
    if (index === undefined || index < 0 || index >= this.stamps.length) return true;
    if (this.stamps[index] === this.current) return false;
    this.stamps[index] = this.current;
    return true;
  }
}
export function indexPagesByUrl<T extends { url: string; streamUrl?: string }>(
  pages: readonly T[],
) {
  const byUrl = new Map<string, T[]>();
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i],
      key = pageRequestUrl(rec);
    let list = byUrl.get(key);
    if (!list) byUrl.set(key, (list = []));
    list.push(rec);
  }
  return byUrl;
}
/** Le repli sans estampilles : un seul ensemble pour tout l'hôte, vidé à chaque appel. */
const vuesSansEstampille = new Set<string>();
export function collectPendingUrls<
  T extends { array?: Uint32Array; url: string; streamUrl?: string; requestIndex?: number },
>(shown: readonly T[], into: string[], stamps?: RequestStamps) {
  into.length = 0;
  if (stamps) stamps.begin();
  const seen = stamps ? undefined : vuesSansEstampille;
  seen?.clear();
  for (let i = 0; i < shown.length; i++) {
    const rec = shown[i];
    if (rec.array) continue;
    const key = pageRequestUrl(rec);
    if (stamps) {
      if (!stamps.first(rec.requestIndex)) continue;
    } else {
      if (seen!.has(key)) continue;
      seen!.add(key);
    }
    into.push(key);
  }
  return into;
}
/** Hand a loaded page or bundle to every record that shares it; a bundled record gets a view at its
 *  own offset, so one request makes dozens of clusters drawable. */
export function acceptPageArray<
  T extends { array?: Uint32Array; indexBytes: number; triangles: number; streamOffset?: number },
>(recs: readonly T[], array: Uint32Array) {
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i],
      offset = rec.streamOffset;
    const view =
      offset === undefined ? array : array.subarray(offset / 4, offset / 4 + rec.triangles * 3);
    rec.array = view;
    rec.indexBytes = view.byteLength;
  }
}
