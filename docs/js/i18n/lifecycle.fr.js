export const lifecycleFr = {
  prepare: {
    description:
      'Compile une scène source vers le cache lu par le navigateur. Lance le compilateur natif puis renvoie le manifeste avec ses mesures. `resourceBaseUrl` est obligatoire : c’est l’URL depuis laquelle le navigateur chargera pages et textures.',
    values: [
      {
        desc: 'Dossier avec `manifest.json`, dossier contenant un seul glTF/GLB, ou fichier `.gltf`, `.glb`, `.fbx` ou `.obj`. Les faces polygonales des lecteurs USD, Blender, Alembic et Maya sont triangulées à l’import : une face strictement convexe en éventail, en un seul passage sur ses coins, toute autre par découpe en oreilles, qui garde l’aire et le contour d’une face concave.',
      },
      { desc: 'Dossier de cache. La source n’est jamais écrasée.' },
      { desc: "`'slice'` ou `'full'`." },
      { desc: 'Budget de triangles, `150000` par défaut.' },
      {
        desc: "`{ resourceBaseUrl, executable, threads = 2, ramBudgetMb = 256, simplification = 'none', signal, onProgress }`. `WEB_GEOMETRY_COMPILER_BIN` désigne l’exécutable si `executable` est absent.",
      },
    ],
  },
  prepareMany: {
    description:
      'Prépare plusieurs modèles dans un seul processus du compilateur. Il exécute `workers` tâches à la fois et partage `ramBudgetMb` entre elles. La promesse renvoie le résumé du lot, uniquement des pointeurs.',
    values: [
      {
        desc: 'Tableau non vide de tâches `{ id, source, cache, scope, triangles, resourceBaseUrl, simplification, threads, ramBudgetMb }`.',
      },
      {
        desc: '`{ workers, ramBudgetMb, threads, onEvent }`. `createBatchProgress` affiche une ligne par identifiant dans l’ordre d’arrivée.',
      },
    ],
  },
  createExplorer: {
    description:
      'Ouvre un cache compilé sur un élément canevas ou son ID littéral (ExplorerTarget). Avec `interactive: true`, le moteur affiche une première image, gère les contrôles, suit la taille CSS et le DPR, puis redessine à la demande. Ce mode utilise WebGPU par défaut et refuse son absence. Sans cette option, l’hôte pilote le rendu. Il reste propriétaire du canevas et appelle `dispose()` à la fermeture. La caméra cadre les bornes chargées ; les détails arrivent progressivement. Pour une capture déterministe, utilisez une session manuelle avec `awaitPages()`.',
    valuesTitle: 'Ce que propose l’explorateur',
    values: [
      {
        desc: 'Après une modification de caméra, scène ou lumière : programme une image en mode interactif ; dessine immédiatement en mode manuel.',
      },
      { desc: 'Dessine une image et renvoie ses `FrameMetrics`.' },
      {
        desc: 'Poses de caméra ; la pose d’accueil vient des bornes, les autres de `pointsOfInterest`.',
      },
      {
        desc: 'Attend les pages lues par la vue ; `flush()` redessine jusqu’à une capture déterministe.',
      },
      { desc: 'Choisit un `DiagnosticMode` et lit ceux que ce backend sait produire.' },
      { desc: 'Modifie le seuil d’erreur écran de la coupe.' },
      { desc: 'Lit la surface dessinée ou redimensionne les cibles.' },
      { desc: 'Quantiles CPU/GPU par étape et rapport de télémétrie.' },
      { desc: 'Éclairage de scène, déclaré avant la préparation du premier backend.' },
      { desc: 'Libère backends, appareil GPU et sources. Obligatoire.' },
    ],
  },
  createExplorerJob: {
    description:
      'Même création avec un élément canevas ou un ID, sous forme de tâche annulable. Attendez `createExplorerJob`, puis `job.promise`. L’identifiant de tâche est distinct de celui du canevas : les événements de préparation deviennent sa progression et une interruption avant la fin libère l’explorateur qui aurait été renvoyé. Une fois terminée, l’appelant possède l’explorateur.',
  },
  createJob: {
    description:
      'Encapsule une opération en attente dans le contrat de tâche du moteur : instantané, abonnement et annulation qui libère ce que la tâche possédait. L’opération doit permettre l’interruption par son propriétaire.',
  },
  detectCapabilities: {
    description:
      'Décrit ce que cette machine prend réellement en charge avant l’ouverture d’un explorateur : `{ tier, renderer, adapter, extensions, reason }`. La raison est toujours fournie ; une capacité absente est signalée, jamais supposée.',
  },
  runCameraPath: {
    description:
      'Outil de campagne : contrôle d’image A/A exact, puis blocs chronométrés sur la même liste de poses. Ce n’est pas un verdict de performance général ; chaque backend rejoue les mêmes poses sans mélanger les moteurs dans un bloc.',
  },
  replicateInstances: {
    description:
      'Instancie la source 1, 4 ou 9 fois en partageant géométrie et matériaux. Outil de mesure pour des scènes plus grandes que l’actif présent sur disque.',
  },
  createGpuPageCache: {
    description:
      'Adaptateur WebGPU borné de tampons et de file qui conserve les pages résidentes, avec la source HTTP qui l’alimente. La résidence suit ce que l’image lit réellement dans le budget déclaré.',
  },
};
