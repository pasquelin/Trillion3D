# Intégration Web / Electron / Node

- **Web** : `createExplorer` + boucle hôte. Le canvas, le RAF et la destruction appartiennent à l’application.
- **Electron** : `prepare` dans le processus principal, `createExplorer` dans le renderer. Aucun import Electron dans le SDK.
- **Node** : `prepare` / `prepareReference` / CLI `web-geometry-compile`.
- **Autre langage** : Format 1 (pointeur JSON + `clusters.json` + pages SHA-256 + `source.gltf`). L’interface reste le manifeste versionné.

Repli : `detectCapabilities('webgl')` ne touche jamais WebGPU. Un backend WebGPU absent ou perdu revient au chemin Three.js sans message utilisateur ; les événements `audience:'diagnostic'` restent pour le laboratoire.
