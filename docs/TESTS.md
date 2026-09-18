# Tests et bancs de performance

Une commande par intention, un emplacement par nature de test. Tout ce qui suit est vérifié :
les comptes sont ceux de l'arborescence, et `test/test-gpu.test.mjs` tient la liste des sondes.

## 1. Arborescence

```
packages/
  sdk-core/            57 *.test.ts      — tests unitaires, collés à leur source
    bench/
      *.perf.mjs          6 bancs de performance
      socle.mjs           l'entrée unique des bancs
      socle/              mesure.mjs, rapport.mjs, ecart.mjs, ulp.mjs, baseline.mjs
      oracles/            les implémentations de référence, recopiées telles quelles
  sdk-browser/        244 *.test.ts
    bench/
      *.perf.mjs         38 bancs de performance
      oracles/            oracles du paquet
      appui/              28 modules d'appui : scènes, rejeux, jeux de cas
  sdk-node/             5 *.test.mjs
test/
  integration/         10 *.test.mjs     — architecture, frontières, contrats d'export
  browser/             20 *.browser.mjs  — rendu dans un Chromium réel (18 lancés, 2 écartés)
  justesse/            18 sondes GPU + 25 modules d'appui
  appui/               27 modules partagés : serveur de fixtures, pages servies
  fixtures/            scènes et données de test
  assets/              le corpus de formats sources, hors dépôt (66 Mo, ignoré par git)
  test-gpu.mjs         l'exécuteur des tests matériels, avec son test
scripts/
  mesure/perf/          agrege.mjs (rapport), baseline-save.mjs (baselines)
```

Une règle : **le test unitaire vit à côté de sa source**, le reste vit sous `test/`, rangé par
nature. Un banc va dans le paquet dont il mesure le code, et l'atteint par chemin relatif.

## 2. Les quatre commandes

| Commande | Ce qu'elle lance |
|---|---|
| `pnpm test` | les 306 tests unitaires, les 10 tests d'intégration et les tests des scripts |
| `pnpm run test:gpu` | les 18 sondes de justesse GPU puis les preuves de rendu lançables, en série |
| `pnpm run perf:all` | les 44 bancs, puis le rapport agrégé |
| `pnpm run validate` | la porte complète avant fusion |

`pnpm run test:changed` et `pnpm run check:changed` ne jouent que ce que les fichiers modifiés
touchent ; aucun des deux ne remplace `validate`.

### Tests unitaires et d'intégration

Ils valident les algorithmes, les frontières de paquets et les contrats publics. Ils ne montent
aucun appareil graphique et tournent partout.

### Sondes de justesse GPU

`test/justesse/` vérifie ce que la carte calcule vraiment : précision des shaders WGSL, planchers
d'erreur, matrices de projection, coordonnées de texels, relectures. Une sonde est un fichier dont
le nom porte un tiret ; les autres fichiers du dossier sont ses modules d'appui, jamais lancés
seuls. `test/browser/` rend des images dans un Chromium réel et les compare.

Les deux dossiers se découvrent **par une règle, jamais par une liste tenue à la main** : tout
`test/browser/*.browser.mjs` est lancé, et les noms suivent la même convention que les sondes et les
bancs — kebab explicite, `coupe-gpu-tenue`, `normale-eclairage-petite-echelle`.

Ce qui ne peut pas tourner est **déclaré** dans `BROWSER_ECARTES` (`test/test-gpu.mjs`) avec son
genre et son motif, et la commande l'imprime avant de démarrer — jamais un silence :

- **montage** — la preuve est bonne, la machine n'est pas prête : assets du Lab à recompiler,
  serveur du Lab absent, `timestamp-query` indisponible.
- **régression** — la preuve échoue parce qu'elle a raison. C'est une dette ouverte, portée par une
  ligne de `TODO.md`, qui se retire en corrigeant le moteur.
- **double périmé** — la preuve tient une copie à la main d'un contrat que la source a fait évoluer
  sans elle. Le moteur est juste, le double a dérivé : il se répare en lisant le contrat plutôt qu'en
  le recopiant.

`test/test-gpu.test.mjs` tient la garde symétrique des deux dossiers : **lancés ∪ écartés == le
disque**, et aucun écart ne survit au fichier qu'il nomme. Sans elle, une preuve oubliée ne
s'exécute jamais sans que rien ne le dise — ce qui est arrivé à dix d'entre elles.

```bash
pnpm run test:gpu                                  # tout
node test/test-gpu.mjs test/justesse/reflexion-cone.mjs   # une cible
```

### Bancs de performance

Un banc mesure un calcul du paquet sur des cas nommés et **le confronte à un oracle** :
l'implémentation d'avant l'optimisation, recopiée telle quelle sous `bench/oracles/`. Chaque ligne
publiée porte sa médiane, son p95, ses nanosecondes par élément, ses opérations par seconde, son
écart à la baseline, et le verdict de l'oracle.

Trois formes de verdict, jamais un silence :

- **✓ / ✗** — l'égalité au bit près (`ecart.mjs` : `-0`, `NaN`, tableaux typés, `Map`, `Set`), ou la
  tolérance que le banc déclare (`differences` + `tolere`, comptés en ULP par `ulp.mjs`).
- **écart publié** (`ecartPublie`) — le banc mesure un candidat *refusé* et chiffre ce qu'il déplace,
  au lieu de réclamer une égalité qui n'a pas lieu d'être. C'est le cas de C1 (`raster-tampon`) et de
  C3 (`pages-anneau`).
- **motif** — il n'y a pas d'oracle, et la ligne dit pourquoi et où la justesse est tenue. Un oracle
  périmé est déclaré comme tel, jamais supprimé en silence.

`mesure()` refuse de démarrer si le `fichier` qu'un banc dit mesurer n'existe pas.

## 3. Baselines et rapport

`pnpm run perf:all` dépose un fragment par domaine dans `.mesure/perf/`, puis
`scripts/mesure/perf/agrege.mjs` en tire un tableau unique, écrit sous
`.mesure/out/perf/perf-<date>.md` et `.json`.

`pnpm run perf:baseline` transforme les fragments en baselines sous `.mesure/baselines/`, une par
domaine, chaque ligne repérée par le couple mesure/cas. Elles sont **hors du dépôt et propres à la
machine** : un temps ne vaut que sur le matériel qui l'a relevé. Sans baseline, la colonne « vs
baseline » affiche `—` et le rapport écrit « aucune baseline sur cette machine : rien de comparé »
— il n'annonce jamais zéro régression faute d'avoir comparé.

Le rapport signale une charge machine supérieure à 4 : au-dessus, les temps ne concluent rien.

### Ce que ces bancs ne mesurent pas

Le chronomètre tourne dans le processus qui vient d'appeler l'oracle, après une chauffe. C'est
suffisant pour suivre une dérive d'un lot à l'autre sur la même machine ; ce n'est pas un relevé de
campagne. Une campagne publiable se joue avec le harnais de `scripts/mesure/` (voir son README),
machine calme, et se compare à budget, scène et pose identiques.

## 4. Portes qualité

| Commande | Rôle |
|---|---|
| `pnpm run check:lines` | 200 lignes physiques au plus par fichier JS/TS/Rust maintenu |
| `pnpm run check:duplicates` | aucun bloc dupliqué de ≥ 12 lignes et ≥ 100 jetons |
| `pnpm run check:structure` | étanchéité des frontières de paquets, sdk-core typé sans DOM |
| `pnpm run check:unused` | exports et fichiers morts (`knip`) |
| `pnpm run validate` | la porte complète : format, lint, tests, builds, structure, liens |
