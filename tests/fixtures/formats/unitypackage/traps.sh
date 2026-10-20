#!/bin/sh
# Regenerates empty.unitypackage and folder-escape.unitypackage; run from this folder.
python3 -c "import tarfile; tarfile.open('empty.unitypackage','w:gz').close()"
python3 -c "
import io, tarfile
guid = '0' * 32
with tarfile.open('folder-escape.unitypackage', 'w:gz') as tar:
    for name, payload in ((guid + '/pathname', b'../escape/Map.unity\n'), (guid + '/asset', b'%YAML 1.1\n')):
        info = tarfile.TarInfo(name)
        info.size = len(payload)
        tar.addfile(info, io.BytesIO(payload))
"
