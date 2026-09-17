# Tests transverses

Ce répertoire regroupe ce qui n'appartient à aucun paquet en particulier. Les tests unitaires, eux,
vivent à côté de leur source, sous `packages/*/`.

- **`integration/`** — 10 tests d'architecture et de contrat (`engineStructure`, `engineNoThree`,
  `public`, `dts-extensions`…), joués par `pnpm test`.
- **`browser/`** — 24 tests de rendu exécutés dans un Chromium réel (WebGPU / WebGL2).
- **`justesse/`** — 17 sondes de précision matérielle, plus leurs modules d'appui. Une sonde est un
  fichier dont le nom porte un tiret ; les autres ne se lancent jamais seuls.
- **`appui/`** — les modules partagés par les tests de rendu : serveur de fixtures, captures,
  pages servies au navigateur.
- **`fixtures/`** — scènes et données de test.

`browser/` et `justesse/` se lancent ensemble par `pnpm run test:gpu`
(`scripts/test-gpu.mjs`, dont `scripts/test-gpu.test.mjs` vérifie la liste).

Documentation complète : [`docs/TESTS.md`](../docs/TESTS.md).
