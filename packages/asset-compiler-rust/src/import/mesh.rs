use super::*;

pub(super) struct MeshOut {
    pub(super) mesh: Value,
    pub(super) triangles: usize,
}
/// One glTF mesh per (ufbx mesh, resolved material list): instances sharing both share the mesh.
pub(super) fn mesh_json(
    mesh: &ufbx::Mesh,
    materials: &[Option<usize>],
    bin: &mut Bin,
    accessors: &mut Vec<Value>,
    report: &mut Report,
) -> Option<MeshOut> {
    let mut primitives = Vec::new();
    let mut triangles = 0usize;
    let mut scratch: Vec<u32> = Vec::new();
    let whole: Vec<u32>;
    let parts: Vec<(usize, &[u32])> = if mesh.material_parts.is_empty() {
        whole = (0..mesh.num_faces as u32).collect();
        vec![(0, &whole[..])]
    } else {
        mesh.material_parts
            .iter()
            .map(|p| (p.index as usize, p.face_indices.as_ref()))
            .collect()
    };
    let has_normal = mesh.vertex_normal.exists;
    let has_uv = mesh.vertex_uv.exists;
    let has_color = mesh.vertex_color.exists;
    report.add_count(
        "mesh-skinning",
        usize::from(!mesh.skin_deformers.is_empty()),
    );
    report.add_count(
        "mesh-blend-shapes",
        usize::from(!mesh.blend_deformers.is_empty()),
    );
    for (material_slot, faces) in parts {
        let mut out = Vertices::default();
        let mut unique: CornerMap = CornerMap::default();
        for &face_index in faces {
            let face = mesh.faces[face_index as usize];
            if face.num_indices < 3 {
                continue;
            }
            let count = ufbx::triangulate_face_vec(&mut scratch, mesh, face) as usize * 3;
            for &corner in &scratch[..count] {
                let c = corner as usize;
                // Un sommet est ce qu'il vaut, pas le rang que le fichier lui donne : un FBX qui
                // écrit ses normales et ses UV coin par coin (Unreal, Blender) sortirait sinon trois
                // sommets par triangle, aucun partagé, et le simplificateur du DAG — qui verrouille
                // tout point présent en plus de deux exemplaires — ne réduirait rien.
                let mut values = [0.0f32; CORNER_VALUES];
                let p = mesh.vertex_position.values[mesh.vertex_position.indices[c] as usize];
                values[CORNER_POSITION].copy_from_slice(&[p.x as f32, p.y as f32, p.z as f32]);
                if has_normal {
                    let n = mesh.vertex_normal.values[mesh.vertex_normal.indices[c] as usize];
                    let [x, y, z] =
                        crate::shared_math::normalized_or([n.x, n.y, n.z], [0.0, 1.0, 0.0]);
                    values[CORNER_NORMAL].copy_from_slice(&[x as f32, y as f32, z as f32]);
                }
                if has_uv {
                    let t = mesh.vertex_uv.values[mesh.vertex_uv.indices[c] as usize];
                    values[CORNER_UV].copy_from_slice(&[t.x as f32, (1.0 - t.y) as f32]);
                }
                if has_color {
                    let k = mesh.vertex_color.values[mesh.vertex_color.indices[c] as usize];
                    values[CORNER_COLOR]
                        .copy_from_slice(&[k.x as f32, k.y as f32, k.z as f32, k.w as f32]);
                }
                let next = unique.len() as u32;
                let id = *unique
                    .entry(CornerKey(values.map(f32::to_bits)))
                    .or_insert_with(|| {
                        out.positions.extend_from_slice(&values[CORNER_POSITION]);
                        if has_normal {
                            out.normals.extend_from_slice(&values[CORNER_NORMAL]);
                        }
                        if has_uv {
                            out.uvs.extend_from_slice(&values[CORNER_UV]);
                        }
                        if has_color {
                            out.colors.extend_from_slice(&values[CORNER_COLOR]);
                        }
                        next
                    });
                out.indices.push(id);
            }
        }
        if out.indices.is_empty() {
            continue;
        }
        triangles += out.indices.len() / 3;
        let slot = materials.get(material_slot).copied().flatten();
        primitives.push(super::primitive(&out, bin, accessors, slot));
    }
    if primitives.is_empty() {
        return None;
    }
    Some(MeshOut {
        mesh: json!({"name":&*mesh.element.name,"primitives":primitives}),
        triangles,
    })
}

/// Les indices d'une partie, en 16 ou 32 bits selon le nombre de sommets. Le tampon part à sa
/// taille finale : un `flat_map(...).collect()` la redécouvre morceau par morceau.
pub(crate) fn index_bytes(indices: &[u32], vertex_count: usize) -> (Vec<u8>, u32) {
    if vertex_count <= u16::MAX as usize {
        let mut out = Vec::with_capacity(indices.len() * 2);
        out.extend(indices.iter().flat_map(|i| (*i as u16).to_le_bytes()));
        return (out, 5123);
    }
    let mut out = Vec::with_capacity(indices.len() * 4);
    out.extend(indices.iter().flat_map(|i| i.to_le_bytes()));
    (out, 5125)
}

#[cfg(test)]
#[path = "mesh_tests.rs"]
mod tests;
