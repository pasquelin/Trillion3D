"""CC0: deterministic KMZ package of the authored KML and COLLADA fixtures."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root = Path(__file__).parent
with ZipFile(root / 'scene.kmz', 'w') as archive:
    for name, data in [('doc.kml', (root / 'doc.kml').read_bytes()), ('models/scene.dae', (root.parent / 'collada/scene.dae').read_bytes())]:
        entry = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        archive.writestr(entry, data)
