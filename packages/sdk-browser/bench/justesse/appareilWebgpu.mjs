// L'ouverture d'un appareil WebGPU dans la page, écrite une seule fois pour toutes les
// reproductions « GPU réellement exécuté » : noyau de sélection du DAG, rasterisation, normales
// d'éclairage, caméra parentée et lots d'adressage. Cinq copies du même prologue avaient déjà
// divergé — l'une d'elles ne filtrait pas les messages de compilation et n'attendait pas la file.
//
// Ce module ne connaît que le navigateur : `pageWebgpu.mjs` injecte le texte de `ouvrirAppareil`
// dans la page (`toString`), et la page empaquetée par esbuild (`cameraParenteeGpuPage.mjs`)
// l'importe. Une seule écriture pour les deux chemins, donc un seul contrat.

/**
 * Ouvre l'appareil, branche la collecte des erreurs non capturées, et rend de quoi compiler et
 * refermer proprement. Rend `null` quand la page n'a pas d'adaptateur WebGPU.
 *
 * - `compile(code)` rend `{ module, compilation }` ; `compilation` ne retient que les messages de
 *   type `error`, les avertissements du compilateur WGSL n'étant pas des écarts de justesse.
 * - `fermer()` attend la file (`onSubmittedWorkDone`) avant de lire `adapter.info` et de détruire
 *   l'appareil, puis rend le relevé de la carte sous ses deux formes : `court` (constructeur et
 *   architecture) et `complet` (les quatre champs renseignés). `adapter.info` n'est pas clonable,
 *   seules ces chaînes traversent le pont de la page.
 */
export async function ouvrirAppareil() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const erreurs = [];
  device.addEventListener('uncapturederror', (event) => erreurs.push(event.error.message));
  return {
    device,
    erreurs,
    async compile(code) {
      const module = device.createShaderModule({ code });
      const compilation = (await module.getCompilationInfo()).messages
        .filter((message) => message.type === 'error')
        .map((message) => message.message);
      return { module, compilation };
    },
    async fermer() {
      await device.queue.onSubmittedWorkDone();
      const info = adapter.info ?? {};
      const champs = ['vendor', 'architecture', 'device', 'description'].map((c) => info[c]);
      device.destroy();
      return {
        court: `${champs[0]} ${champs[1]}`,
        complet: champs.filter(Boolean).join(' / '),
      };
    },
  };
}
