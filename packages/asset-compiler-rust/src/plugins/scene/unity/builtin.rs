//! Primitive meshes Unity provides without a file.
//!
//! A scene can place a cube without any asset carrying its geometry: the `MeshFilter` points to
//! the GUID of the editor's built-in resources. No Unity byte is redistributed or read here:
//! the unit cube is a geometric shape, rebuilt from its definition — one metre of edge, centred
//! on the origin, six faces of constant normal, front winding in glTF space. The other
//! primitives (sphere, capsule, cylinder, plane) have an editor-specific tessellation that
//! cannot be reproduced faithfully: they are counted in the report, never approximated.
use super::*;
use std::collections::HashMap;

/// GUID of the editor's built-in resources, as it appears in scenes.
pub(super) const BUILTIN_GUID: &str = "0000000000000000e000000000000000";
/// `fileID` of the cube among them, taken from the CC0 test corpus `unity/cc0-import-project`.
const CUBE: i64 = 10202;
const HALF: f32 = 0.5;

/// Cubes already poured, one per material: two instances of the same pair share their mesh.
#[derive(Default)]
pub(super) struct Builtins {
    by_material: HashMap<Option<usize>, usize>,
}

impl Builtins {
    /// Mesh rank for this built-in primitive, or `None` if it is not reproducible.
    pub(super) fn mesh(
        &mut self,
        file_id: i64,
        material: Option<usize>,
        scene: &mut Scene,
    ) -> Option<usize> {
        if file_id != CUBE {
            scene.report.add("unity-builtin-mesh-unsupported");
            scene.report.notes.push(format!(
                "built-in primitive not reproduced: fileID {file_id}"
            ));
            return None;
        }
        Some(
            *self
                .by_material
                .entry(material)
                .or_insert_with(|| cube(material, scene)),
        )
    }
}

/// Six faces of the unit cube: normal, then the two directions of the plane, chosen so their
/// cross product yields the normal — winding is front, seen from outside.
const FACES: [([f32; 3], [f32; 3], [f32; 3]); 6] = [
    ([1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]),
    ([-1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
    ([0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, -1.0]),
    ([0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
    ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
    ([0.0, 0.0, -1.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
];

fn cube(material: Option<usize>, scene: &mut Scene) -> usize {
    let (mut positions, mut normals, mut uvs, mut indices) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for (normal, u, v) in FACES {
        let first = (positions.len() / 3) as u16;
        for (du, dv) in [(-HALF, -HALF), (HALF, -HALF), (HALF, HALF), (-HALF, HALF)] {
            for axis in 0..3 {
                positions.push(normal[axis] * HALF + u[axis] * du + v[axis] * dv);
            }
            normals.extend_from_slice(&normal);
            uvs.extend_from_slice(&[du + HALF, dv + HALF]);
        }
        indices.extend_from_slice(&[first, first + 1, first + 2, first, first + 2, first + 3]);
    }
    let count = positions.len() / 3;
    let position = accessor(
        scene,
        &f32_bytes(&positions),
        json!({"componentType":5126,"count":count,"type":"VEC3",
               "min":[-HALF,-HALF,-HALF],"max":[HALF,HALF,HALF]}),
        Some(34962),
    );
    let normal = accessor(
        scene,
        &f32_bytes(&normals),
        json!({"componentType":5126,"count":count,"type":"VEC3"}),
        Some(34962),
    );
    let uv = accessor(
        scene,
        &f32_bytes(&uvs),
        json!({"componentType":5126,"count":count,"type":"VEC2"}),
        Some(34962),
    );
    let index_bytes: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
    let index = accessor(
        scene,
        &index_bytes,
        json!({"componentType":5123,"count":indices.len(),"type":"SCALAR"}),
        Some(34963),
    );
    let mut primitive =
        json!({"attributes":{"POSITION":position,"NORMAL":normal,"TEXCOORD_0":uv},"indices":index});
    if let Some(material) = material {
        primitive["material"] = json!(material);
    }
    scene
        .meshes
        .push(json!({"name":"UnityBuiltinCube","primitives":[primitive]}));
    scene.mesh_triangles.push(indices.len() / 3);
    scene.meshes.len() - 1
}

fn accessor(scene: &mut Scene, bytes: &[u8], mut fields: Value, target: Option<u32>) -> usize {
    let view = scene.bin.view(bytes, target);
    fields["bufferView"] = json!(view);
    scene.accessors.push(fields);
    scene.accessors.len() - 1
}
