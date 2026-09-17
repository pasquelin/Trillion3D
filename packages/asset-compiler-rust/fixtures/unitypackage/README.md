# Fixture de correction — pilote `unitypackage`, conteneur

Un conteneur ne doit rien changer au projet qu'il emballe. La fixture est donc double : le même
projet Unity **dans** son `.unitypackage` et **à plat** hors de lui. Le doré
(`../../src/tests/unitypackage_golden.rs`) compile les deux par le harnais commun, compare la
seconde à la première, puis compare la première à `expected.json`.

| fichier                          | ce qu'il fixe                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `test.unitypackage`              | le paquet : 11 dossiers de GUID, chacun avec `pathname`, `asset` et `asset.meta` — scène, prefabs, matériaux, FBX, texture TGA |
| `hors-paquet/Assets/`            | le contenu de `test.unitypackage`, reconstruit une fois pour toutes : le même projet sans conteneur   |
| `sortie-de-dossier.unitypackage` | un `pathname` `../escape/Map.unity` : la sortie du dossier d'extraction, refusée `ARCHIVE_PATH_ESCAPE` |
| `tronque.unitypackage`           | 31 des 26 432 octets de `test.unitypackage` : le flux gzip s'arrête, refus `ARCHIVE_UNREADABLE`       |
| `vide.unitypackage`              | les 63 octets d'un tar.gz sans entrée : refus `ARCHIVE_EMPTY`                                         |

Ce que chaque choix met sous surveillance :

- **l'arbre reconstruit** : le paquet ne porte aucun chemin de projet dans ses entrées, seulement un
  dossier par GUID ; `Assets/Materials/Standard.mat` n'existe que parce que le pilote a lu le
  `pathname` du GUID et y a recopié `asset`, et `Assets/Map.unity.meta` que parce qu'il y a recopié
  `asset.meta` ;
- **les `.meta` de tout le projet** : l'attendu fixe `metaFiles: 11`, donc les onze `.meta` sont
  reconstruits au bon endroit — un seul manquant et le pilote Unity ne résoudrait plus son GUID ;
- **un routage qui traverse** : l'extraction ne porte qu'un dossier racine, `Assets/`, que le socle
  traverse avant de router ; le routeur y voit un `.unity` au premier niveau et les `.fbx` rangés
  sous `Models/`, donc un seul pilote revendique et la chaîne `unitypackage` → `unity` se referme ;
- **l'empreinte de chaque fichier lu** : `files` porte le nom, la taille et le sha256 de chaque
  fichier de données ; un octet déplacé par l'extraction s'y verrait ;
- **les trois paquets piégés** : chacun est refusé par son propre code, et rien n'est extrait.

## Provenance et licences

- `test.unitypackage` et `hors-paquet/` : corpus WebGeometry
  (`test/assets/unity/cc0-unitypackage`, généré par `test/assets/tools/unity_assets.py`),
  **CC0-1.0**, voir [LICENSE.txt](LICENSE.txt). `test/assets/` n'est pas suivi par git : ces octets
  sont recopiés ici pour que la dorée tienne sans lui. Le contenu du paquet garde la licence de son
  auteur — ce pilote n'en accorde ni n'en retire aucune.
- `tronque.unitypackage` : corpus WebGeometry (`test/assets/limites/truncated-unitypackage`),
  **CC0-1.0**, même notice.
- `hors-paquet/` est la reconstruction du paquet, **au script C# près** : `Assets/Editor/`
  n'en porte que le `.meta`, pas le `.cs`. Ce pilote ne lit que des données et aucun script n'a sa
  place dans une fixture ; le `.meta` reste pour que le projet à plat compte les mêmes onze `.meta`
  que le projet reconstruit, donc pour que les deux compilations soient comparables.
- `sortie-de-dossier.unitypackage` et `vide.unitypackage` : synthétiques, écrits pour ce test, sans
  contenu d'aucun tiers. Ils se régénèrent par

  ```sh
  python3 -c "import tarfile; tarfile.open('vide.unitypackage','w:gz').close()"
  python3 -c "
  import io, tarfile
  guid = '0' * 32
  with tarfile.open('sortie-de-dossier.unitypackage', 'w:gz') as tar:
      for name, payload in ((guid + '/pathname', b'../escape/Map.unity\n'), (guid + '/asset', b'%YAML 1.1\n')):
          info = tarfile.TarInfo(name)
          info.size = len(payload)
          tar.addfile(info, io.BytesIO(payload))
  "
  ```

  Ils sont écrits par un outil extérieur, et non par les caisses que le pilote utilise pour lire :
  un paquet piégé doit venir d'ailleurs que du lecteur qu'il met à l'épreuve.

## `expected.json`

Le pilote retenu, la chaîne `unitypackage` → pilote interne publiée au rapport, les trois codes de
refus, et la scène — version de format, fichiers lus avec leur empreinte, comptes du pilote Unity,
version du sidecar binaire, sha256 de `clusters.bin`, comptes de primitives, de nœuds et de
triangles. La clé de compilation n'y figure pas : le manifeste d'une scène convertie porte sa durée
d'import, donc cette clé change d'un passage à l'autre sans que la scène bouge. C'est `files` qui
tient lieu d'identité, et c'est sur lui que repose l'égalité des deux compilations. `case` et `rule`
ne sont que de la prose, le test les retire avant de comparer.
