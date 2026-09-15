//! Les maillages primitifs que Unity fournit sans fichier.
//!
//! Une scène peut poser un cube sans qu'aucun asset ne porte sa géométrie : le `MeshFilter` renvoie
//! au GUID des ressources intégrées de l'éditeur. Aucun octet de Unity n'est redistribué ni lu ici :
//! le cube unité est une forme géométrique, reconstruite depuis sa définition — un mètre d'arête,
//! centré sur l'origine, six faces à normale constante, enroulement direct dans l'espace glTF. Les
//! autres primitives (sphère, capsule, cylindre, plan) ont une tessellation propre à l'éditeur que
//! l'on ne peut pas reproduire fidèlement : elles sont comptées au rapport, jamais approchées.
use super::*;
use std::collections::HashMap;

/// Le GUID des ressources intégrées de l'éditeur, tel qu'il apparaît dans les scènes.
pub(super) const BUILTIN_GUID: &str = "0000000000000000e000000000000000";
/// Le `fileID` du cube parmi elles, relevé sur le corpus de test CC0 `unity/cc0-import-project`.
const CUBE: i64 = 10202;
const HALF: f32 = 0.5;

/// Les cubes déjà versés, un par matériau : deux instances du même couple partagent leur maillage.
#[derive(Default)]
pub(super) struct Builtins {
    by_material: HashMap<Option<usize>, usize>,
}

impl Builtins {
    /// Le rang du maillage pour cette primitive intégrée, ou `None` si elle n'est pas reproductible.
    pub(super) fn mesh(
        &mut self,
        file_id: i64,
        material: Option<usize>,
        scene: &mut Scene,
    ) -> Option<usize> {
        if file_id != CUBE {
            scene.report.add("unity-builtin-mesh-unsupported");
            scene.report.notes.push(format!(
                "primitive intégrée non reproduite: fileID {file_id}"
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

/// Les six faces du cube unité : normale, puis les deux directions du plan, choisies pour que leur
/// produit vectoriel redonne la normale — l'enroulement est direct, vu de l'extérieur.
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
