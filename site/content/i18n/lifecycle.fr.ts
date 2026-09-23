import type { LocaleOverlay } from './entryOverlay.ts';

export const lifecycleFr: LocaleOverlay = {
  prepare: {
    description:
      'Compile une scène source vers le cache lu par le navigateur. Lance le compilateur natif puis renvoie le manifeste avec ses mesures. Une source dont le produit est déjà dans le cache n’est pas recompilée : le dossier est vérifié fichier par fichier puis conservé, et `reused` dit ce qui a été contrôlé (`null` quand la tâche a compilé). `resourceBaseUrl` est obligatoire : c’est l’URL depuis laquelle le navigateur chargera pages et textures. Ce que chaque lecteur fait de sa source — faces polygonales coupées en éventail si convexes, en oreilles sinon — est dans `docs/COMPILER.md`.',
    values: [
      {
        desc: 'Dossier avec `manifest.json`, dossier contenant un seul glTF/GLB, ou fichier `.gltf`, `.glb`, `.fbx` ou `.obj`.',
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
  createWorld: {
    description:
      "Crée un monde vide sur un élément canevas ou son ID. Le monde possède la scène, la caméra, le moteur de rendu et la boucle ; rien d’autre n’est construit — un modèle compilé se charge ensuite avec `scene.load`, comme tout ce qu’on ajoute à la scène. `interactive` vaut vrai par défaut : le monde soumet des images à la demande et se met en pause une fois l’image stable pendant 120 images, et reprend sur `invalidate()`. `renderer` est absent par défaut (le moteur prend la meilleure voie que la machine permet) ou en nomme un explicitement (`'webgpu'` / `'webgl2'`) ; en forcer un sur une machine qui ne l’a pas est refusé nommément, jamais servi en silence par l’autre. `controls` choisit le contrôleur de caméra (`'orbit'` | `'fly'` | `'firstPerson'` | `'trackball'` | `'panZoom'` | `'none'`, la valeur par défaut), relu ou changé ensuite via `world.controls.kind`.",
    valuesTitle: 'Ce que propose le monde',
    values: [
      {
        desc: 'Construit la scène depuis `geometry`/`material`/`object`/`light`, ou charge un cache compilé ; `load` se résout avec le `LoadedModel` (`bounds`, `lights`).',
      },
      {
        desc: 'Une `Camera` vivante : `position.set(...)`, `lookAt(...)`, `fov`/`near`/`far`, ou `camera.set(pose)` avec une `CameraPose` comme celle que renvoie `pose.fromBounds(box3)`.',
      },
      {
        desc: 'Le contrôleur vivant qui pilote la caméra depuis le canevas : `.kind`, `.enabled`, `.target` — réglé à la création, modifiable à tout moment.',
      },
      {
        desc: 'Le crochet par image (`loop` en est l’alias) et la demande de redessiner après un changement manuel ; renvoie une fonction de désabonnement.',
      },
      {
        desc: 'Dessine une image à la main (boucle tenue par l’hôte, `interactive: false`) ; redimensionne les cibles.',
      },
      {
        desc: 'Le multiplicateur appliqué à la radiance linéaire avant ACES ; ne peut éclairer une surface qu’aucune lumière déclarée n’atteint.',
      },
      { desc: 'L’erreur écran de la coupe du DAG, en pixels — `0` garde les feuilles exactes.' },
      {
        desc: 'Fixe ou relit les pools géométrie/texture fixes (`geometryPool`, `texturePool`, `geometryPoolCeiling`).',
      },
      {
        desc: 'Choisit ce que l’image dessine (`beauty` | `clusters` | `wireframe` | `triangles`), et lit les modes que cet appareil sait produire.',
      },
      {
        desc: 'La courbe de tone mapping appliquée à la composition, p. ex. `toneMapping.aces` (la valeur par défaut).',
      },
      { desc: 'Libère le moteur de rendu, l’appareil GPU et chaque page résidente. Obligatoire.' },
    ],
  },
  createWorldJob: {
    description:
      'Un monde n’a pas d’enveloppe de tâche qui lui soit propre : `scene.load` est une simple promesse, et l’aide générique `createJob` la transforme en tâche annulable avec progression quand un hôte a besoin du même contrat que la compilation.',
  },
  createJob: {
    description:
      'Encapsule une opération en attente dans le contrat de tâche du moteur : instantané, abonnement et annulation qui libère ce que la tâche possédait. L’opération doit permettre l’interruption par son propriétaire.',
  },
  detectCapabilities: {
    description:
      'Décrit ce que cette machine prend réellement en charge avant la création d’un monde : `{ tier, renderer, adapter, extensions, reason }`. L’enveloppe publique qu’un monde relit est `capability.detect()` — `{ webgpu, webgl2, ... }`, une forme plus simple pour la même sonde. La raison est toujours fournie ; une capacité absente est signalée, jamais supposée.',
  },
  runCameraPath: {
    title: 'pose.runPath()',
    description:
      'Rejoue une liste de poses sur un monde, répartie sur `images` images (ou une par pose), l’œil et la cible se déplaçant en ligne droite entre deux. Une `CameraPose` est `{ position, target, fov? }` — near/far restent des propriétés de la caméra. En interne, un outil de campagne, `runCameraPath(session, path, { backendIds, warmup, … })`, mène le même rejeu pour le banc : contrôle d’image A/A exact, puis blocs chronométrés ; pas un verdict de performance général, et jamais deux moteurs mélangés dans un même bloc.',
  },
  replicateInstances: {
    description:
      'Instancie la source 1, 4 ou 9 fois en partageant géométrie et matériaux — l’option `replicaCount` passe par là. Outil de mesure atteint seulement par le point d’entrée de mesure (`packages/sdk-browser/src/measurement/measurement.ts`), pour des scènes plus grandes que l’actif présent sur disque ; hors du point d’entrée publié de `web-geometry`.',
  },
  createGpuPageCache: {
    title: 'page.createCache() · page.httpSource()',
    description:
      'La famille `page` : la géométrie coupée en pages, qui entrent et sortent de la mémoire selon ce que l’image lit. `page.createCache` est l’adaptateur WebGPU borné de tampons et de file (`createGpuPageCache`) qui conserve les pages résidentes ; `page.httpSource` la source HTTP qui l’alimente (`httpPageSource`). Le moteur de rendu interne qui consomme les mêmes pages et réglages de LOD est choisi par l’option `renderer` de `createWorld`, jamais nommé par un hôte.',
  },
};
