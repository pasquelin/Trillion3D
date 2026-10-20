#!/bin/sh
# Regenerates empty.zip and folder-escape.zip; run from this folder.
python3 -c "import zipfile; zipfile.ZipFile('empty.zip','w').close()"
python3 -c "import zipfile; z=zipfile.ZipFile('folder-escape.zip','w'); z.writestr('../escape.gltf','{\"asset\":{\"version\":\"2.0\"}}'); z.close()"
