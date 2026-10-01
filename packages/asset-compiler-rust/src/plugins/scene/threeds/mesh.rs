//! Faces retain authored order and material assignment; smoothing masks produce corner normals.
use super::*;
use crate::shared_math::{cross, sub, unit};
pub(super) fn read(
    bytes: &[u8],
    materials: &BTreeMap<String, usize>,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<usize> {
    let mut object = Reader::new(bytes);
    let name = object.string()?;
    let (id, data) = object.chunk()?;
    object.finish()?;
    if id != 0x4100 {
        return Err(source::unsupported("3ds", format!("object chunk {id:04x}")));
    }
    let mut mesh = Reader::new(data);
    let mut vertices = Vec::new();
    let mut uv = Vec::new();
    let mut faces = Vec::new();
    let mut groups = Vec::new();
    let mut masks = Vec::new();
    let mut matrix = None;
    while !mesh.empty() {
        let (id, data) = mesh.chunk()?;
        let mut r = Reader::new(data);
        match id {
            0x4110 => {
                let count = r.u16()? as usize;
                source::admit(count * 64, request.ram_budget / 4, "3ds")?;
                for _ in 0..count {
                    vertices.push([r.float()?, r.float()?, r.float()?]);
                }
                r.finish()?;
            }
            0x4140 => {
                let count = r.u16()? as usize;
                for _ in 0..count {
                    uv.push([r.float()? as f32, 1. - r.float()? as f32]);
                }
                r.finish()?;
            }
            0x4160 => {
                let mut v = [0.; 12];
                for n in &mut v {
                    *n = r.float()?;
                }
                r.finish()?;
                matrix = Some(v);
            }
            0x4120 => {
                let count = r.u16()? as usize;
                source::admit(count * 512, request.ram_budget / 2, "3ds")?;
                for _ in 0..count {
                    faces.push([r.u16()? as usize, r.u16()? as usize, r.u16()? as usize]);
                    r.u16()?;
                }
                while !r.empty() {
                    let (id, data) = r.chunk()?;
                    let mut face = Reader::new(data);
                    match id {
                        0x4130 => {
                            let material = face.string()?;
                            let count = face.u16()?;
                            let mut assigned = Vec::new();
                            for _ in 0..count {
                                assigned.push(face.u16()? as usize);
                            }
                            face.finish()?;
                            groups.push((material, assigned));
                        }
                        0x4150 => {
                            for _ in 0..count {
                                masks.push(face.u32()?);
                            }
                            face.finish()?;
                        }
                        _ => {
                            return Err(source::unsupported("3ds", format!("face chunk {id:04x}")))
                        }
                    }
                }
            }
            _ => return Err(source::unsupported("3ds", format!("mesh chunk {id:04x}"))),
        }
    }
    if !uv.is_empty() && uv.len() != vertices.len() {
        return Err(source::invalid("3ds", "UV count differs from vertex count"));
    }
    if !masks.is_empty() && masks.len() != faces.len() {
        return Err(source::invalid(
            "3ds",
            "smoothing count differs from face count",
        ));
    }
    let mut assigned = vec![None; faces.len()];
    for (name, indices) in groups {
        let material = *materials
            .get(&name)
            .ok_or_else(|| source::invalid("3ds", "unknown face material"))?;
        for index in indices {
            let slot = assigned
                .get_mut(index)
                .ok_or_else(|| source::invalid("3ds", "material face index out of bounds"))?;
            if slot.replace(material).is_some() {
                return Err(source::invalid("3ds", "face assigned multiple materials"));
            }
        }
    }
    let mut normals = Vec::new();
    let mut adjacent = vec![Vec::new(); vertices.len()];
    for (rank, face) in faces.iter().enumerate() {
        let mut points = [[0.; 3]; 3];
        for (corner, index) in face.iter().enumerate() {
            points[corner] = *vertices
                .get(*index)
                .ok_or_else(|| source::invalid("3ds", "face vertex out of bounds"))?;
            adjacent[*index].push(rank);
        }
        normals.push(cross(sub(points[1], points[0]), sub(points[2], points[0])));
    }
    let work = adjacent.iter().try_fold(0usize, |total, faces| {
        total.checked_add(faces.len().saturating_mul(faces.len()))
    });
    if !masks.is_empty() && work.is_none_or(|value| value > 10_000_000) {
        return Err(source::unsupported(
            "3ds",
            "smoothing adjacency exceeds ten million contributions",
        ));
    }
    let mut parts: Vec<(Vertices, Option<usize>)> = Vec::new();
    for (rank, face) in faces.iter().enumerate() {
        if super::super::cancel::stopped(request.cancelled, rank) {
            return Err(super::super::cancel::refusal());
        }
        if parts.last().is_none_or(|p| p.1 != assigned[rank]) {
            parts.push((Vertices::default(), assigned[rank]));
        }
        let out = &mut parts.last_mut().unwrap().0;
        for index in face {
            let mut normal = normals[rank];
            if masks.get(rank).is_some_and(|v| *v != 0) {
                normal = [0.; 3];
                for other in &adjacent[*index] {
                    if masks[*other] & masks[rank] != 0 {
                        for (axis, n) in normal.iter_mut().enumerate() {
                            *n += normals[*other][axis];
                        }
                    }
                }
            }
            out.indices.push(
                u32::try_from(out.count())
                    .map_err(|_| source::invalid("3ds", "too many corners"))?,
            );
            out.positions.extend(vertices[*index].map(|v| v as f32));
            out.normals
                .extend(unit(normal).unwrap_or([0.; 3]).map(|v| v as f32));
            if !uv.is_empty() {
                out.uvs.extend(uv[*index]);
            }
        }
    }
    let mesh = source::mesh_bounded(scene, &name, &parts, request)?;
    // 3DS point coordinates are already in editor/world space; TRI_LOCAL records the
    // modelling frame, not an additional placement. Preserve it without applying twice.
    Ok(scene.node(json!({"name":name,"mesh":mesh,"extras":{"sourceLocalFrame":matrix}})))
}
