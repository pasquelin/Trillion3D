#!/bin/sh
# Regenerates vide.zip and sortie-de-dossier.zip; run from this folder.
python3 -c "import zipfile; zipfile.ZipFile('vide.zip','w').close()"
python3 -c "import zipfile; z=zipfile.ZipFile('sortie-de-dossier.zip','w'); z.writestr('../escape.gltf','{\"asset\":{\"version\":\"2.0\"}}'); z.close()"
