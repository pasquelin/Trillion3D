# Fixture d'import FBX — l'opacité d'un matériau classique

`riviere.fbx` est un FBX 7400 **ASCII** de 3 Ko écrit à la main : un quad, un matériau `M_Riviere`
en `phong`, deux textures. Il reproduit au plus court la forme exacte que prend l'opacité dans
`Village2.fbx` (Whisperwind Village, 409 Mo, hors dépôt) :

- `ShadingModel: "phong"` — donc `ufbx` classe le matériau en `FbxPhong`, `features.pbr` reste
  éteint et **`pbr.opacity` n'a ni valeur ni texture** ;
- `TransparentColor` porte la transparence *et* la carte d'opacité (`C: "OP",5000,3000,
  "TransparentColor"`), `TransparencyFactor` le facteur.

Les deux images (`albedo.png`, `opacite.png`) ne sont pas versionnées : le test les écrit à côté de
la copie jetable du FBX, comme les fixtures OBJ. La seule chose qui compte ici est le chemin que
prend l'opacité, pas le contenu des pixels.

Pour brancher la même texture sur la couleur de base et sur l'opacité, le test remplace la dernière
connexion par `C: "OP",4000,3000, "TransparentColor"` ; c'est le cas où glTF peut porter l'alpha
dans `baseColorTexture`.
