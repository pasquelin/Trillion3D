/** Deux requêtes : la passe de mélange, puis celle de transmission. Une passe qui n'est pas encodée
 *  laisse sa requête à zéro, ce que la résolution écrit elle-même. */
const QUERIES = 2,
  BYTES = QUERIES * 8;

export type BlendOverdraw = ReturnType<typeof createBlendOverdraw>;

/**
 * Le comptage du surdessin des transparents, par requête d'occlusion : le nombre d'échantillons que
 * la passe fait passer le test de profondeur, c'est-à-dire les fragments réellement mélangés. Le
 * rapporter aux pixels de l'image donne le taux de recouvrement MOYEN de la passe ; le maximum par
 * pixel n'est pas mesuré ici — une requête d'occlusion ne rend qu'une somme — et reste `null`.
 *
 * Diagnostic seul : monté par la variante `transparents-surdessin` et par elle seule. La lecture ne
 * bloque jamais une image : une seule est en vol, les suivantes gardent le dernier compte revenu.
 */
export function createBlendOverdraw(device: GPUDevice) {
  const set = device.createQuerySet({ type: 'occlusion', count: QUERIES });
  const resolve = device.createBuffer({
    label: 'WG overdraw resolve',
    size: BYTES,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const read = device.createBuffer({
    label: 'WG overdraw readback',
    size: BYTES,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  let pending = false,
    encoded = false;
  const counts = {
    fragmentsMelanges: 0,
    pixelsImage: 0,
    /** Le recouvrement moyen en millièmes : un compteur est un entier, jamais une durée. */
    recouvrementMoyenMillemes: 0,
    relevés: 0,
  };
  return {
    set,
    /** Ouvre la requête de la passe : zéro pour le mélange, une pour la transmission. */
    begin(pass: GPURenderPassEncoder, transmissive: boolean) {
      pass.beginOcclusionQuery(transmissive ? 1 : 0);
    },
    end(pass: GPURenderPassEncoder) {
      pass.endOcclusionQuery();
    },
    /** Après la fin de la passe : résout les requêtes, et n'en copie une qu'à vol libre. */
    after(encoder: GPUCommandEncoder) {
      encoder.resolveQuerySet(set, 0, QUERIES, resolve, 0);
      if (pending) return;
      encoder.copyBufferToBuffer(resolve, 0, read, 0, BYTES);
      encoded = true;
    },
    /** Une fois l'image soumise : récupère le compte quand il revient, sans jamais l'attendre. */
    pull(pixels: number) {
      if (!encoded || pending) return counts;
      encoded = false;
      pending = true;
      read
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const values = new BigUint64Array(read.getMappedRange());
          const fragments = Number(values[0]) + Number(values[1]);
          read.unmap();
          counts.fragmentsMelanges = fragments;
          counts.pixelsImage = pixels;
          counts.recouvrementMoyenMillemes = pixels ? Math.round((fragments / pixels) * 1000) : 0;
          counts.relevés++;
        })
        .catch(() => {
          /* Une image perdue ou un appareil libéré annule la lecture : le dernier compte reste. */
        })
        .finally(() => {
          pending = false;
        });
      return counts;
    },
    dispose() {
      set.destroy();
      resolve.destroy();
      read.destroy();
    },
  };
}
