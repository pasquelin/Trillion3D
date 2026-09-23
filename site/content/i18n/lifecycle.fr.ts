import type { LocaleOverlay } from './entryOverlay.ts';

export const lifecycleFr: LocaleOverlay = {
  prepare: {
    description:
      'Compile une scène source vers le cache lu par le navigateur. Lance le compilateur natif puis renvoie le manifeste avec ses mesures. Une source dont le produit est déjà dans le cache n’est pas recompilée : le dossier est vérifié fichier par fichier puis conservé, et `reused` dit ce qui a été contrôlé (`null` quand la tâche a compilé). `resourceBaseUrl` est obligatoire : c’est l’URL depuis laquelle le navigateur chargera pages et textures. Ce que chaque lecteur fait de sa source — faces polygonales coupées en éventail si convexes, en oreilles sinon — est dans `docs/COMPILER.md`.',
  },
  prepareMany: {
    description:
      'Prépare plusieurs modèles dans un seul processus du compilateur. Il exécute `workers` tâches à la fois et partage `ramBudgetMb` entre elles. La promesse renvoie le résumé du lot, uniquement des pointeurs.',
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
};
