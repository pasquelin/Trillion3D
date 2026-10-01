"""Authored geometry, encoded independently by McNeel rhino3dm 8.17.0 (MIT).
Run with that Python package available; no source asset is downloaded.
"""
from pathlib import Path
from uuid import UUID
import rhino3dm as r
ROOT = Path(__file__).parent

def mesh():
    value = r.Mesh()
    for p in [(0, 0, 0), (1000, 0, 0), (0, 1000, 0)]:
        value.Vertices.Add(*p)
    value.Faces.AddFace(0, 1, 2)
    value.Normals.ComputeNormals()
    return value

def attrs(n, name, material=0):
    value = r.ObjectAttributes()
    value.Id = UUID(int=n)
    value.Name = name
    value.MaterialIndex = material
    value.MaterialSource = r.ObjectMaterialSource.MaterialFromObject
    return value

def document():
    value = r.File3dm()
    value.Settings.ModelUnitSystem = r.UnitSystem.Millimeters
    for name, color in [('red', (255, 0, 0, 255)), ('green', (0, 255, 0, 255))]:
        material = r.Material()
        material.Name = name
        material.DiffuseColor = color
        value.Materials.Add(material)
    return value

value = document()
value.Objects.AddMesh(mesh(), attrs(1, 'triangle'))
hidden = attrs(2, 'hidden', 1)
hidden.Visible = False
value.Objects.AddMesh(mesh(), hidden)
assert value.Write(str(ROOT / 'meshes.3dm'), 7)

value = document()
definition = value.InstanceDefinitions.Add('triangle block', '', '', '', r.Point3d(0, 0, 0), (mesh(),), (attrs(10, 'member'),))
definition_id = value.InstanceDefinitions[definition].Id
value.Objects.AddInstanceObject(r.InstanceReference(definition_id, r.Transform.Translation(2000, 3000, 4000)), attrs(20, 'placed'))
reflection = r.Transform.Identity()
reflection.M00 = -1
reflection.M03 = -1000
value.Objects.AddInstanceObject(r.InstanceReference(definition_id, reflection), attrs(21, 'mirrored'))
assert value.Write(str(ROOT / 'instances.3dm'), 7)

value = document()
value.Objects.AddSphere(r.Sphere(r.Point3d(0, 0, 0), 1000), attrs(30, 'exact sphere'))
assert value.Write(str(ROOT / 'untessellated.3dm'), 7)

value = document()
colored = mesh()
for color in [(255, 255, 255), (128, 0, 0), (0, 255, 0)]:
    colored.VertexColors.Add(*color)
mapping = r.TextureMapping.CreatePlaneMapping(r.Plane.WorldXY(), r.Interval(0, 1000), r.Interval(0, 1000), r.Interval(-1, 1))
colored.SetTextureCoordinates(mapping, r.Transform.Identity(), False)
value.Objects.AddMesh(colored, attrs(40, 'attributes'))
assert value.Write(str(ROOT / 'attributes.3dm'), 7)

# Active optical properties outside the reader's supported matte/emissive domain.
for filename, kind in [('glossy.3dm', 'glossy'), ('glass.3dm', 'glass'), ('pbr.3dm', 'pbr')]:
    value = document()
    material = value.Materials[0]
    if kind == 'glossy':
        material.Shine = 50
    elif kind == 'glass':
        material.Transparency = 0.5
    else:
        material.ToPhysicallyBased()
        material.PhysicallyBased.Clearcoat = 0.8
    value.Objects.AddMesh(mesh(), attrs(50, kind))
    assert value.Write(str(ROOT / filename), 7)
