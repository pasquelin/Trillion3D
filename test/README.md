# Tests transverses

Ce répertoire regroupe ce qui n'appartient à aucun paquet en particulier. Les tests unitaires, eux,
vivent à côté de leur source, sous `packages/*/`.

- **`integration/`** — 10 tests d'architecture et de contrat (`engineStructure`, `engineNoThree`,
  `public`, `dts-extensions`…), joués par `pnpm test`.
- **`browser/`** — 20 preuves de rendu exécutées dans un Chromium réel (WebGPU / WebGL2) : 18
  lancées, 2 écartées avec leur motif dans `BROWSER_ECARTES` (`scripts/test-gpu.mjs`).
- **`justesse/`** — 18 sondes de précision matérielle, plus leurs 25 modules d'appui. Une sonde est
  un fichier dont le nom porte un tiret ; les autres ne se lancent jamais seuls.
- **`appui/`** — les modules partagés par les tests de rendu : serveur de fixtures, pages
  servies au navigateur, jeux de cas.
- **`fixtures/`** — scènes et données de test.

Les deux dossiers se découvrent par une règle et leurs noms suivent la convention des bancs et des
sondes : kebab explicite. `browser/` et `justesse/` se lancent ensemble par `pnpm run test:gpu`
(`scripts/test-gpu.mjs`), et `scripts/test-gpu.test.mjs` garde l'égalité **lancés ∪ écartés ==
disque** dans les deux : aucun fichier ne peut cesser de s'exécuter en silence.

Documentation complète : [`docs/TESTS.md`](../docs/TESTS.md).
