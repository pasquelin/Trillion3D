import bpy, sys

out = sys.argv[sys.argv.index("--") + 1]
for block in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for item in list(block):
        block.remove(item)
scene = bpy.context.scene

def material(name, colour):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = colour
    return mat

red = material("Red", (0.8, 0.1, 0.1, 1.0))
blue = material("Blue", (0.1, 0.1, 0.8, 1.0))

cube = bpy.data.meshes.new("Cube")
verts = [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
cube.from_pydata(verts, [], faces)
cube.materials.append(red)
cube.materials.append(blue)
uv = cube.uv_layers.new(name="UVMap")
square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
for face in cube.polygons:
    face.material_index = face.index % 2
    face.use_smooth = True
    for rank, corner in enumerate(face.loop_indices):
        u, v = square[rank]
        uv.data[corner].uv = (0.25 * face.index + 0.2 * u, v)
for edge in cube.edges:
    edge.use_edge_sharp = all(verts[i][2] == 1 for i in edge.vertices)
cube.update()

ngon = bpy.data.meshes.new("Ngon")
ring = [(0, 0, 0), (2, 0, 0), (2, 2, 0), (1, 1, 0.5), (0, 2, 0)]
ngon.from_pydata(ring, [], [tuple(range(len(ring)))])
ngon.materials.append(blue)
ngon.polygons[0].use_smooth = False
ngon.update()

for name, data, place, turn in (
    ("CubeA", cube, (0, 0, 0), (0, 0, 0)),
    ("CubeB", cube, (4, 0, 0), (0, 0, 0.5)),
    ("Ngon", ngon, (0, 4, 0), (0.3, 0, 0)),
):
    obj = bpy.data.objects.new(name, data)
    obj.location = place
    obj.rotation_euler = turn
    scene.collection.objects.link(obj)

bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
