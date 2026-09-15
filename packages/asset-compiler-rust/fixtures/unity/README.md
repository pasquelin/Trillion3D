# Fixtures Unity

## `cc0-import-project`

Projet Unity minimal, **CC0-1.0**, repris du corpus local `test-assets/unity/cc0-import-project`
(généré par `test-assets/tools/unity_assets.py`, corpus WebGeometry, 15 septembre 2026). Le dépôt
ignore `test-assets/` : seuls les fichiers dont le pilote a besoin sont copiés ici, avec leur
notice, `LICENSE.txt`. Le script C# de l'éditeur du corpus n'est pas repris — ce pilote ne lit que
des données, et aucun script n'a sa place dans une fixture.

Repris tel quel : `Assets/Map.unity` et ses `.meta`, `Assets/Materials/{Standard,URP,HDRP}.mat`,
`Assets/Models/LODProp.fbx` (LOD 320/80/20 triangles), `Assets/Prefabs/Prop_Standard.prefab`,
`Assets/Textures/checker.tga`.

Ajouté ici, sous la même licence CC0-1.0, pour couvrir ce que le corpus ne porte pas — la scène du
corpus ne pose que des cubes intégrés avec un `LODGroup` :

- `Prop_Model` : un `MeshFilter` qui renvoie au FBX par GUID, en position (1, 2, 3), tourné d'un
  quart de tour autour de Y et à l'échelle 2 — la conversion d'axes et la composition avec le
  pilote FBX y sont vérifiées en clair ;
- une lampe sur ce même objet, pour qu'elle soit comptée sans être rendue ;
- `Prop_Cutout` et `Prop_Glass` avec `Assets/Materials/{Cutout,Glass}.mat`, écrits ici : modes
  découpé (Standard `_Mode: 1`, `_Cutoff: 0.25`) et transparent (URP `_Surface: 1`, alpha 0,5,
  émission, double face) ;
- `Prop_Hidden`, inactif, qui ne doit produire aucun nœud ;
- une instance de `Prop_Standard.prefab` replacée en (-4, 0, 5) et renommée `Prop_Copy`.

L'attendu de la dorée est dans `cc0-import-project/expected.json`.

## `limites`

`truncated.unity` : les 31 premiers octets de `Map.unity`, repris du corpus
`test-assets/limites/truncated-unity` (CC0-1.0, notice dans `LICENSE.txt`). Un fichier sans aucun
document doit être refusé proprement, sans panique ni allocation non bornée.
