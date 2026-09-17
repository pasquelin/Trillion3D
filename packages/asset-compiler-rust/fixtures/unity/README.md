# Fixtures Unity

## `cc0-import-project`

Projet Unity minimal, **CC0-1.0**, repris du corpus local `test/assets/unity/cc0-import-project`
(généré par `test/assets/tools/unity_assets.py`, corpus WebGeometry, 15 septembre 2026). Le dépôt
ignore `test/assets/` : seuls les fichiers dont le pilote a besoin sont copiés ici, avec leur
notice, `LICENSE.txt`. Le script C# de l'éditeur du corpus n'est pas repris — ce pilote ne lit que
des données, et aucun script n'a sa place dans une fixture.

Repris tel quel : `Assets/Map.unity` et ses `.meta`, `Assets/Materials/{Standard,URP,HDRP}.mat`,
`Assets/Models/LODProp.fbx` (LOD 320/80/20 triangles), `Assets/Prefabs/Prop_Standard.prefab`,
`Assets/Textures/checker.tga`.

Ajouté ici, sous la même licence CC0-1.0, pour couvrir ce que le corpus ne porte pas — la scène du
corpus ne pose que des cubes intégrés avec un `LODGroup` :

- `Prop_Model` : un `MeshFilter` qui renvoie au FBX par GUID, en position (1, 2, 3), tourné d'un
  quart de tour autour de Y et à l'échelle 2 — la conversion d'axes et la composition avec le
  pilote FBX y sont vérifiées en clair ; son `fileID` ne figure pas dans la table de noms du
  `.meta`, donc le modèle entier est instancié et le fait est compté ;
- `Prop_SubMesh` : le même modèle, mais un `MeshFilter` qui vise le `fileID` 4300002, que la table
  `internalIDToNameTable` du `.meta` nomme `Icosphere.001` — seul ce maillage est retenu ;
- `LODProp.fbx.meta` déclare `globalScale: 2` et `useFileScale: 1` : l'échelle d'import s'applique
  aux nœuds versés du modèle, jamais à sa géométrie ;
- une lampe sur ce même objet, pour qu'elle soit comptée sans être rendue ;
- `Prop_Cutout` et `Prop_Glass` avec `Assets/Materials/{Cutout,Glass}.mat`, écrits ici : modes
  découpé (Standard `_Mode: 1`, `_Cutoff: 0.25`) et transparent (URP `_Surface: 1`, alpha 0,5,
  émission, double face) ;
- `Prop_Hidden`, inactif, qui ne doit produire aucun nœud ;
- `Prop_Glass` porte des `fileID` de vrai projet, au-delà de 2^53
  (`33000014169494082`, `23000014090315290`) : lus au travers d'un flottant ils désigneraient un
  objet qui n'existe pas, et l'objet disparaîtrait de la scène ;
- deux instances de `Prop_Standard.prefab` : `Prop_Copy`, replacée en (-4, 0, 5), renommée, remise à
  l'échelle en y, dont le matériau du rendu de LOD0 est remplacé par `Glass` et dont l'objet `LOD2`
  est désactivé ; `Prop_Muted`, dont le rendu de LOD0 est éteint. Les retouches que ce pilote ne
  rend pas — `m_StaticEditorFlags`, `m_TagString` — restent comptées, propriété par propriété.

Le dossier `cc0-import-project` lui-même sert de preuve au routeur : il porte une scène et un FBX,
et se route vers `unity` sans qu'on lui désigne quoi que ce soit.

L'attendu de la dorée est dans `cc0-import-project/expected.json`.

## `limites`

`truncated.unity` : les 31 premiers octets de `Map.unity`, repris du corpus
`test/assets/limites/truncated-unity` (CC0-1.0, notice dans `LICENSE.txt`). Un fichier sans aucun
document doit être refusé proprement, sans panique ni allocation non bornée.
