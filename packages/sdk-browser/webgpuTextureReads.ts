import type { TextureJob } from './webgpuAtlasJobs.ts';

/** Tranches qu'un appareil peut refuser pour un même niveau avant qu'il quitte la file : au
 *  troisième refus il est abandonné, compté dans `textureSkipped`, plus jamais réessayé. La même
 *  borne vaut pour les lectures d'un niveau cuit qui échouent. */
export const MAX_FAILURES = 3;
/** Niveaux cuits tenus en mémoire à la fois — en cours de lecture, ou lus et pas encore
 *  transférés en entier : assez pour couvrir la latence d'un serveur, pas assez pour que des images
 *  décodées s'accumulent en attendant leur transfert. Un niveau lu quitte le compte à sa dernière
 *  bande, quand il sort de la file. */
export const MAX_FETCHES = 6;

/**
 * Les lectures des niveaux cuits, à côté de la pompe : un niveau cuit se lit dans le cache avant
 * de se transférer, et c'est la file — ordonnée par ce que la caméra regarde — qui dit lesquels
 * lire d'abord. Rien n'est attendu ici ; une barrière qui veut converger attend `settled`.
 */
export function createTextureReads(options: {
  jobs: TextureJob[];
  onFailure: (phase: string, error: unknown) => void;
  onAbandon: (job: TextureJob, reason: string) => void;
}) {
  const inFlight = new Set<Promise<void>>();
  let fetched = 0;
  const abandon = (job: TextureJob, reason: string) => {
    const at = options.jobs.indexOf(job);
    if (at >= 0) options.jobs.splice(at, 1);
    options.onAbandon(job, reason);
  };
  return {
    abandon,
    /**
     * Lance la lecture des premiers niveaux de la file qui ne sont pas encore en main, dans l'ordre
     * que la caméra vient de dicter, jamais plus de `MAX_FETCHES` tenus en mémoire — un niveau lu
     * dont le transfert n'est pas fini garde son image décodée et compte donc encore. Une lecture
     * qui échoue compte comme un refus ; au troisième, le niveau quitte la file.
     */
    prefetch() {
      let running = inFlight.size;
      for (const job of options.jobs) if (job.fetch && job.ready) running++;
      for (const job of options.jobs) {
        if (running >= MAX_FETCHES) break;
        if (job.ready || !job.fetch || job.fetching) continue;
        job.fetching = true;
        running++;
        const pending = job
          .fetch()
          .then(() => {
            fetched++;
          })
          .catch((error: unknown) => {
            options.onFailure('texture-level-read-failed', error);
            if (++job.failures >= MAX_FAILURES) abandon(job, 'read-failed');
          })
          .finally(() => {
            job.fetching = false;
            inFlight.delete(pending);
          });
        inFlight.add(pending);
      }
    },
    /** Tenue quand toutes les lectures en vol ont abouti ou échoué ; `null` sans lecture en vol. */
    settled(): Promise<void> | null {
      return inFlight.size ? Promise.allSettled([...inFlight]).then(() => undefined) : null;
    },
    get fetched() {
      return fetched;
    },
  };
}
