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
        let mut positions: Vec<f32> = Vec::new();
        let mut normals: Vec<f32> = Vec::new();
        let mut uvs: Vec<f32> = Vec::new();
        let mut colors: Vec<f32> = Vec::new();
        let mut indices: Vec<u32> = Vec::new();
        let mut unique: CornerMap = CornerMap::default();
        let mut min = [f32::MAX; 3];
        let mut max = [f32::MIN; 3];
        for &face_index in faces {
            let face = mesh.faces[face_index as usize];
            if face.num_indices < 3 {
                continue;
            }
            let count = ufbx::triangulate_face_vec(&mut scratch, mesh, face) as usize * 3;
            for &corner in &scratch[..count] {
                let c = corner as usize;
                let key = (
                    mesh.vertex_position.indices[c],
                    if has_normal {
                        mesh.vertex_normal.indices[c]
                    } else {
                        0
                    },
                    if has_uv { mesh.vertex_uv.indices[c] } else { 0 },
                    if has_color {
                        mesh.vertex_color.indices[c]
                    } else {
                        0
                    },
                );
                let next = unique.len() as u32;
                let id = *unique.entry(key).or_insert_with(|| {
                    let p = mesh.vertex_position.values[key.0 as usize];
                    let v = [p.x as f32, p.y as f32, p.z as f32];
                    crate::shared_math::extend_aabb_f32(&mut min, &mut max, v);
                    positions.extend_from_slice(&v);
                    if has_normal {
                        let n = mesh.vertex_normal.values[key.1 as usize];
                        let len = (n.x * n.x + n.y * n.y + n.z * n.z).sqrt();
                        let (x, y, z) = if len > 1e-12 {
                            (n.x / len, n.y / len, n.z / len)
                        } else {
                            (0.0, 1.0, 0.0)
                        };
                        normals.extend_from_slice(&[x as f32, y as f32, z as f32]);
                    }
                    if has_uv {
                        let t = mesh.vertex_uv.values[key.2 as usize];
                        uvs.extend_from_slice(&[t.x as f32, (1.0 - t.y) as f32]);
                    }
                    if has_color {
                        let c = mesh.vertex_color.values[key.3 as usize];
                        colors.extend_from_slice(&[c.x as f32, c.y as f32, c.z as f32, c.w as f32]);
                    }
                    next
                });
                indices.push(id);
            }
        }
        if indices.is_empty() {
            continue;
        }
        let vertex_count = unique.len();
        let mut attributes = json!({});
        let view = bin.view(&f32_bytes(&positions), Some(34962));
        accessors.push(json!({"bufferView":view,"componentType":5126,"count":vertex_count,"type":"VEC3","min":min,"max":max}));
        attributes["POSITION"] = json!(accessors.len() - 1);
        if has_normal {
            let view = bin.view(&f32_bytes(&normals), Some(34962));
            accessors.push(
                json!({"bufferView":view,"componentType":5126,"count":vertex_count,"type":"VEC3"}),
            );
            attributes["NORMAL"] = json!(accessors.len() - 1);
        }
        if has_uv {
            let view = bin.view(&f32_bytes(&uvs), Some(34962));
            accessors.push(
                json!({"bufferView":view,"componentType":5126,"count":vertex_count,"type":"VEC2"}),
            );
            attributes["TEXCOORD_0"] = json!(accessors.len() - 1);
        }
        if has_color {
            let view = bin.view(&f32_bytes(&colors), Some(34962));
            accessors.push(
                json!({"bufferView":view,"componentType":5126,"count":vertex_count,"type":"VEC4"}),
            );
            attributes["COLOR_0"] = json!(accessors.len() - 1);
        }
        let (bytes, component) = index_bytes(&indices, vertex_count);
        let view = bin.view(&bytes, Some(34963));
        accessors.push(json!({"bufferView":view,"componentType":component,"count":indices.len(),"type":"SCALAR"}));
        let mut primitive = json!({"attributes":attributes,"indices":accessors.len()-1,"mode":4});
        if let Some(Some(material)) = materials.get(material_slot) {
            primitive["material"] = json!(material);
        }
        triangles += indices.len() / 3;
        primitives.push(primitive);
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
