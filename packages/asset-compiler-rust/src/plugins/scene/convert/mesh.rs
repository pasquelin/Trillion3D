use super::*;
use crate::compiler::accessor::codes::{UNSIGNED_INT, UNSIGNED_SHORT};
use crate::plugins::scene::corners::{gltf_uv, Corners};

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
    cancelled: &AtomicBool,
) -> Option<MeshOut> {
    let mut primitives = Vec::new();
    let mut triangles = 0usize;
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
    // The sets past the first the file holds, each by its rank in its own list.
    let extra: Vec<_> = (1..MAX_UV_SETS)
        .filter_map(|set| {
            Some((set, &mesh.uv_sets.get(set)?.vertex_uv)).filter(|(_, uv)| uv.exists)
        })
        .collect();
    let has_color = mesh.vertex_color.exists;
    let deform = MeshDeform::of(mesh);
    for (material_slot, faces) in parts {
        let out = Vertices {
            targets: (0..deform.targets()).map(|_| Default::default()).collect(),
            ..Default::default()
        };
        let mut corners: Corners<[u32; CORNER_VALUES]> = Corners::new(out);
        for &face_index in faces {
            let face = mesh.faces[face_index as usize];
            if face.num_indices < 3 {
                continue;
            }
            corners.begin();
            for c in face.index_begin as usize..(face.index_begin + face.num_indices) as usize {
                // A vertex is what it is worth, not the index the file gives it: an
                // FBX that writes normals and UVs corner by corner (as most exporters do)
                // would otherwise come out as three vertices per triangle, none
                // shared, and the DAG simplifier — which locks any point present in
                // more than two copies — would reduce nothing.
                let mut values = [0.0f32; CORNER_VALUES];
                let p = mesh.vertex_position.values[mesh.vertex_position.indices[c] as usize];
                values[CORNER_POSITION].copy_from_slice(&[p.x as f32, p.y as f32, p.z as f32]);
                if has_normal {
                    let n = mesh.vertex_normal.values[mesh.vertex_normal.indices[c] as usize];
                    let [x, y, z] = trillion3d_math::vector::vec3::normalized_or(
                        [n.x, n.y, n.z],
                        [0.0, 1.0, 0.0],
                    );
                    values[CORNER_NORMAL].copy_from_slice(&[x as f32, y as f32, z as f32]);
                }
                if has_uv {
                    let t = mesh.vertex_uv.values[mesh.vertex_uv.indices[c] as usize];
                    values[CORNER_UV].copy_from_slice(&gltf_uv([t.x as f32, t.y as f32]));
                }
                for &(set, uv) in &extra {
                    let t = uv.values[uv.indices[c] as usize];
                    values[corner_extra_uv(set)]
                        .copy_from_slice(&gltf_uv([t.x as f32, t.y as f32]));
                }
                if has_color {
                    let k = mesh.vertex_color.values[mesh.vertex_color.indices[c] as usize];
                    values[CORNER_COLOR]
                        .copy_from_slice(&[k.x as f32, k.y as f32, k.z as f32, k.w as f32]);
                }
                let vertex = mesh.vertex_indices[c];
                if deform.deformed() {
                    // The index as its own bits: a float would round the ones past 2^24 together.
                    values[CORNER_VERTEX] = f32::from_bits(vertex);
                }
                corners.corner(values.map(f32::to_bits), [p.x, p.y, p.z], |out| {
                    out.positions.extend_from_slice(&values[CORNER_POSITION]);
                    if has_normal {
                        out.normals.extend_from_slice(&values[CORNER_NORMAL]);
                    }
                    if has_uv {
                        out.uvs.extend_from_slice(&values[CORNER_UV]);
                    }
                    for &(set, _) in &extra {
                        out.extra_uvs[set - 1].extend_from_slice(&values[corner_extra_uv(set)]);
                    }
                    if has_color {
                        out.colors.extend_from_slice(&values[CORNER_COLOR]);
                    }
                    deformed_vertex(&deform, vertex, out);
                });
            }
            corners.cut(cancelled, false)?;
        }
        report.add_count(crate::plugins::scene::codes::NGON_UNCUT, corners.uncut);
        let out = corners.vertices;
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
        mesh: json!({"name":&*mesh.element.name,"primitives":primitives,"weights":deform.weights()}),
        triangles,
    })
}

/// Appends `vertex`'s bones and shape offsets to `out`, on a mesh that deforms.
fn deformed_vertex(deform: &MeshDeform<'_>, vertex: u32, out: &mut Vertices) {
    if let Some((joints, weights)) = deform.influences(vertex as usize) {
        out.joints.extend(joints);
        out.weights.extend(weights);
    }
    for (target, (offsets, normals)) in out.targets.iter_mut().enumerate() {
        let offset = deform.offset(target, vertex);
        offsets.extend_from_slice(&offset[..3]);
        if deform.bends(target) {
            normals.extend_from_slice(&offset[3..]);
        }
    }
}

/// Indices of a part, in 16 or 32 bits depending on the vertex count. The buffer
/// starts at its final size: a `flat_map(...).collect()` rediscovers it chunk by
/// chunk.
pub(crate) fn index_bytes(indices: &[u32], vertex_count: usize) -> (Vec<u8>, usize) {
    if vertex_count <= u16::MAX as usize {
        let mut out = Vec::with_capacity(indices.len() * 2);
        out.extend(indices.iter().flat_map(|i| (*i as u16).to_le_bytes()));
        return (out, UNSIGNED_SHORT);
    }
    let mut out = Vec::with_capacity(indices.len() * 4);
    out.extend(indices.iter().flat_map(|i| i.to_le_bytes()));
    (out, UNSIGNED_INT)
}

#[cfg(test)]
mod tests;
