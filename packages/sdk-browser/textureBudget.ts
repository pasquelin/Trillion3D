import type { TextureJob } from './webgpuAtlasJobs.ts';

/**
 * Le budget d'octets de textures que la session engage sur la carte graphique.
 *
 * Le registre compte les octets ENGAGÉS : ceux des niveaux entièrement transférés, plus les lignes
 * déjà écrites d'un niveau en cours. Tant qu'il reste sous le budget, rien ne change pour personne ;
 * au-delà, un niveau ne démarre que si la file peut lui faire de la place.
 *
 * L'éviction porte sur les transferts EN COURS, jamais sur un niveau achevé. Un niveau à moitié
 * transféré n'est pas montré — la résidence de sa couche n'avance qu'à la dernière ligne — donc le
 * remettre à zéro ne coûte que les lignes déjà écrites et rend sa bande passante à une couche que la
 * caméra regarde vraiment. Défaire un niveau achevé, lui, dégraderait une image déjà nette sans rien
 * libérer : l'atlas est une texture-tableau allouée d'avance, et aucun octet ne lui est rendu. La
 * fidélité passe donc avant le compteur : une couche nette le reste.
 *
 * Le budget est levé pendant `flush()`, où l'image doit converger : sans cela, la file refusée ne se
 * viderait jamais et la capture de référence tournerait sans fin.
 *
 * Il ne descend jamais sous les octets que les atlas ont DÉJÀ alloués. Une classe d'atlas est une
 * texture-tableau créée en entier à la préparation, couches et chaîne de mips comprises : la carte
 * les porte que le transfert parte ou non. Refuser le niveau 0 d'une couche allouée ne rend donc pas
 * un octet, il retient seulement l'aperçu de 64 px à l'écran — et le refus est définitif, puisque
 * l'éviction ne porte que sur les transferts en cours et qu'une scène posée n'en a aucun. Le budget
 * de l'hôte reprend son sens le jour où la résidence libère vraiment (backlog Textures 3) : il borne
 * alors ce qui est alloué, donc ce plafond avec lui.
 */
export function createTextureBudget(options: {
  budget: number;
  /** Octets que les atlas ont déjà alloués sur la carte ; zéro tant qu'ils n'existent pas. */
  allocated: () => number;
  /** L'utilité d'un travail, telle que l'ordre de l'image l'a calculée. */
  scoreOf: (job: TextureJob) => number;
}) {
  let committed = 0;
  let evictions = 0;
  /** Le plafond réel : le budget demandé, ou l'allocation déjà engagée quand elle le dépasse. */
  const ceiling = () => Math.max(options.budget, options.allocated());
  return {
    /** Octets engagés sur la carte graphique par les transferts de textures. */
    get committed() {
      return committed;
    },
    /** Ce que la session s'autorise vraiment à engager : jamais moins que l'allocation des atlas. */
    get budget() {
      return ceiling();
    },
    /** Transferts défaits depuis le début de la session pour laisser passer plus utile. */
    get evictions() {
      return evictions;
    },
    commit(bytes: number) {
      committed += bytes;
    },
    /**
     * Ce travail peut-il démarrer ? Il tient sous le budget, ou bien la file porte un transfert en
     * cours moins utile que lui, qui est alors défait pour lui laisser la place.
     */
    admits(job: TextureJob, jobs: readonly TextureJob[], unbounded: boolean) {
      const limit = ceiling();
      const needed = (job.rows - job.nextRow) * job.bytesPerRow;
      if (unbounded || committed + needed <= limit) return true;
      if (job.nextRow > 0) return true;
      const score = options.scoreOf(job);
      let victim: TextureJob | undefined,
        worst = score;
      for (let index = 0; index < jobs.length; index++) {
        const other = jobs[index];
        if (other === job || other.nextRow <= 0) continue;
        const otherScore = options.scoreOf(other);
        if (otherScore < worst) {
          worst = otherScore;
          victim = other;
        }
      }
      if (!victim) return false;
      committed -= victim.nextRow * victim.bytesPerRow;
      victim.nextRow = 0;
      evictions++;
      return committed + needed <= limit;
    },
  };
}

/** Borne basse et borne haute du budget par défaut : un appareil modeste garde de quoi travailler,
 *  un appareil large n'engage pas la mémoire entière dans les textures d'une seule scène. */
const MIN_BUDGET = 256 * 1024 * 1024;
const MAX_BUDGET = 4 * 1024 * 1024 * 1024;

/**
 * Le budget par défaut, tiré des limites de l'appareil : quatre fois le plus grand tampon qu'il
 * accepte, borné des deux côtés. Rien n'est mesuré sur la carte — WebGPU ne dit pas sa mémoire — et
 * l'hôte peut toujours poser le sien avec `textureBudgetBytes`.
 */
export function defaultTextureBudgetBytes(device: GPUDevice | undefined) {
  const limit = device?.limits?.maxBufferSize;
  const derived = Number.isFinite(limit) ? (limit as number) * 4 : MIN_BUDGET;
  return Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, derived));
}
