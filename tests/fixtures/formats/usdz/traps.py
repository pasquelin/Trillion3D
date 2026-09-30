import struct, zipfile
LAYER = b'#usda 1.0\n(\n    defaultPrim = "Root"\n)\n\ndef Xform "Root"\n{\n}\n'
def aligned(archive, name, data):
    offset = archive.fp.tell()
    need = (64 - (offset + 30 + len(name.encode())) % 64) % 64
    if 0 < need < 4:
        need += 64
    entry = zipfile.ZipInfo(name)
    entry.compress_type = zipfile.ZIP_STORED
    entry.extra = b"" if need == 0 else struct.pack("<HH", 0x1986, need - 4) + b"\0" * (need - 4)
    archive.writestr(entry, data)
with zipfile.ZipFile("compressee.usdz", "w") as a:
    e = zipfile.ZipInfo("scene.usda"); e.compress_type = zipfile.ZIP_DEFLATED
    a.writestr(e, LAYER * 40)
with zipfile.ZipFile("sans-scene.usdz", "w") as a:
    aligned(a, "textures/checker.png", b"\x89PNG\r\n\x1a\n")
def mesh(name, counts, indices, points):
    return ('#usda 1.0\n(\n    defaultPrim = "Root"\n)\n\ndef Xform "Root"\n{\n'
            f'    def Mesh "{name}"\n    {{\n'
            f'        int[] faceVertexCounts = [{counts}]\n'
            f'        int[] faceVertexIndices = [{indices}]\n'
            f'        point3f[] points = [{points}]\n'
            '    }\n}\n').encode()
with zipfile.ZipFile("deux-scenes.usdz", "w") as a:
    aligned(a, "premiere.usda", mesh("Triangle", "3", "0, 1, 2", "(0, 0, 0), (1, 0, 0), (0, 1, 0)"))
    aligned(a, "seconde.usda", mesh("Quad", "4", "0, 1, 2, 3", "(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)"))
