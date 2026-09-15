/**
 * Images entre deux relevés. Un relevé est un diagnostic : les images d'entre-deux ne copient rien
 * et ne mappent rien, et aucune n'attend jamais le retour d'un relevé.
 */
const READ_EVERY_IMAGES = 15;

/** `GPUMapMode.READ`, ou sa valeur là où un appareil de test laisse l'énumération vide. */
const mapRead = () => (globalThis as { GPUMapMode?: { READ: number } }).GPUMapMode?.READ ?? 1;

/**
 * Le relevé périodique de compteurs écrits par le GPU, une image sur quinze. L'appelant échantillonne
 * une image, encode la copie de ce qu'elle a écrit, puis signale la soumission : le mappage n'est
 * demandé qu'après, sans quoi cette soumission porterait un tampon mappé. Un seul relevé est en
 * route à la fois, et `read` reçoit la plage mappée, à lire sur place avant qu'elle ne soit démappée.
 *
 * Une perte d'appareil ou une libération annule le mappage : les compteurs gardent leur dernière
 * image, rien n'est déduit. Le tampon de relevé est celui de l'appelant, créé avec son propre label.
 */
export function createGpuPeriodicReadback(read: (mapped: ArrayBuffer) => void) {
  let buffer: GPUBuffer | undefined,
    bytes = 0,
    ready = false,
    copyEncoded = false,
    mapping = false,
    disposed = false,
    lastSampledFrame = -READ_EVERY_IMAGES;

  // Les rappels du mappage, faits une fois : une image relevée n'alloue aucune fermeture.
  const onMapped = () => {
    if (disposed || !buffer) return;
    read(buffer.getMappedRange(0, bytes));
    ready = true;
  };
  const onMapFailed = () => {};
  const onSettled = () => {
    try {
      buffer?.unmap();
    } catch {
      /* Déjà démappé par une libération. */
    }
    mapping = false;
  };

  return {
    get buffer() {
      return buffer;
    },
    /** Vrai dès qu'un relevé est revenu, jusqu'à la libération. */
    get ready() {
      return ready;
    },
    /** Adopte le tampon `COPY_DST | MAP_READ` que les copies remplissent ; la libération le détruit. */
    adopt(target: GPUBuffer) {
      buffer = target;
    },
    /** Vrai quand l'intervalle est écoulé et qu'aucun relevé n'est encore en route. */
    due(frame: number) {
      return !mapping && !copyEncoded && frame - lastSampledFrame >= READ_EVERY_IMAGES;
    },
    /** Note l'image échantillonnée : l'intervalle court à partir d'elle. */
    sampled(frame: number) {
      lastSampledFrame = frame;
    },
    /** Encode la copie de `size` octets de `source`, à mapper une fois l'image soumise. */
    copy(encoder: GPUCommandEncoder, source: GPUBuffer, offset: number, size: number) {
      if (!buffer) return;
      encoder.copyBufferToBuffer(source, offset, buffer, 0, size);
      bytes = size;
      copyEncoded = true;
    },
    /** Demande le mappage de la copie encodée. Sans effet sur une image qui n'en a encodé aucune. */
    submitted() {
      if (!copyEncoded || !buffer || disposed) return;
      copyEncoded = false;
      mapping = true;
      Promise.resolve(buffer.mapAsync(mapRead(), 0, bytes))
        .then(onMapped, onMapFailed)
        .finally(onSettled);
    },
    dispose() {
      disposed = true;
      ready = false;
      copyEncoded = false;
      buffer?.destroy();
      buffer = undefined;
    },
  };
}
