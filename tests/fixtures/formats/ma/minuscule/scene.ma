//Maya ASCII 2024 scene
//Fixture écrite à la main pour ce test depuis la documentation publique des commandes MEL.
//Aucun contenu d'un tiers, aucune exportation d'un logiciel : CC0-1.0, voir ../LICENSE.txt.
requires maya "2024";
currentUnit -l centimeter -a degree -t film;
fileInfo "application" "fixture";
createNode transform -n "Racine";
createNode transform -n "Plaque" -p "Racine";
	setAttr ".t" -type "double3" 10 0 0;
	setAttr ".r" -type "double3" 0 90 0;
	setAttr ".ro" 0;
	setAttr ".s" -type "double3" 2 2 2;
createNode mesh -n "PlaqueShape" -p "Plaque";
	setAttr -s 6 ".vt[0:5]" -type "float3" 0 0 0  1 0 0  1 1 0  0 1 0  1 2 0  0 2 0;
	setAttr -s 7 ".ed[0:6]" 0 1 0  1 2 0  2 3 0  3 0 0  2 4 0  4 5 0  5 3 0;
	setAttr -s 6 ".uvst[0].uvsp[0:5]" -type "float2" 0 0  1 0  1 1  0 1  1 2  0 2;
	setAttr -s 2 ".fc[0:1]" -type "polyFaces"
		f 4 0 1 2 3
		mu 0 4 0 1 2 3
		f 4 -3 4 5 6
		mu 0 4 3 2 4 5;
	setAttr ".iog[0].og[0].gcl" -type "componentList" 1 "f[0]";
	setAttr ".iog[0].og[1].gcl" -type "componentList" 1 "f[1]";
createNode transform -n "Copie";
	setAttr ".t" -type "double3" 0 0 30;
parent -add -s "PlaqueShape" "Copie";
createNode transform -n "Vue";
createNode camera -n "VueShape" -p "Vue";
createNode lambert -n "Uni";
	setAttr ".c" -type "float3" 0.8 0.1 0.1;
	setAttr ".dc" 0.9;
createNode shadingEngine -n "UniSG";
	setAttr ".ihi" 0;
createNode standardSurface -n "Verre";
	setAttr ".mt" 1;
	setAttr ".sr" 0.2;
	setAttr ".o" -type "float3" 0.5 0.5 0.5;
	setAttr ".e" 1;
	setAttr ".ec" -type "float3" 0.1 0.1 0.1;
createNode shadingEngine -n "VerreSG";
	setAttr ".ihi" 0;
createNode file -n "Image";
	setAttr ".ftn" -type "string" "textures/checker.png";
createNode place2dTexture -n "Placage";
	setAttr ".wu" no;
connectAttr "Placage.o" "Image.uv";
connectAttr "Image.oc" "Verre.bc";
connectAttr "Uni.oc" "UniSG.ss";
connectAttr "Verre.oc" "VerreSG.ss";
connectAttr "PlaqueShape.iog.og[0]" "UniSG.dsm" -na;
connectAttr "PlaqueShape.iog.og[1]" "VerreSG.dsm" -na;
select -ne :time1;
	setAttr ".o" 1;
python "print('ce texte est une donnée, jamais du code')";
// End of scene.ma
