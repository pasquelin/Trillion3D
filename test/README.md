# Répertoire des tests d'intégration et sondes matérielles

Ce répertoire regroupe les tests transverses qui ne sont pas co-localisés avec un module source unitaire :

- **`justesse/`** : les 40 sondes de précision matérielle WebGPU et arithmétique flottante stricte, exécutées via `npm run test:gpu` (`scripts/test-gpu.mjs`).
- **`*.browser.mjs`** : tests d'intégration de rendu exécutés dans une instance Chromium réelle (WebGPU / WebGL2).
- **`*.test.mjs`** : tests de validation d'architecture (`engineStructure.test.mjs`, `engineNoThree.test.mjs`, `engineNoThreeMath.test.mjs`) et tests des contrats d'export.
- **`fixtures/`** : scènes de test synthétiques et oracles pour l'éclairage et les transferts.

Pour la documentation complète du système de test, voir [`docs/TESTS.md`](../docs/TESTS.md).
