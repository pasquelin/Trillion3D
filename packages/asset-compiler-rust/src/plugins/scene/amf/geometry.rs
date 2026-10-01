//! Volume and corner order are retained; colour precedence is vertex/triangle/volume/object/material.
use super::*;
use crate::{
    import::Vertices,
    shared_math::{cross, sub, unit as normalise},
};

pub(super) fn object(
    node: Node<'_, '_>,
    scale: f64,
    materials: &BTreeMap<usize, (usize, [f32; 4])>,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
    payload: &mut usize,
) -> Result<usize> {
    let id = xml::usize_attribute(node, "id", "amf")?;
    let mesh = xml::required(node, "mesh", "amf")?;
    let vertices = xml::required(mesh, "vertices", "amf")?;
    let mut points = Vec::new();
    let mut colors = Vec::new();
    for vertex in elements(vertices, "vertex") {
        let xyz = xml::required(vertex, "coordinates", "amf")?;
        points.push(
            [
                component(xyz, "x", None)?,
                component(xyz, "y", None)?,
                component(xyz, "z", None)?,
            ]
            .map(|v| source::finite(v * scale, "amf"))
            .into_iter()
            .collect::<Result<Vec<_>>>()?,
        );
        colors.push(color(vertex)?);
    }
    let object_color = color(node)?;
    let mut parts = Vec::new();
    for (volume_rank, volume) in elements(mesh, "volume").enumerate() {
        let declared = volume
            .attribute("materialid")
            .map(|_| xml::usize_attribute(volume, "materialid", "amf"))
            .transpose()?;
        let material = declared
            .map(|id| {
                materials
                    .get(&id)
                    .copied()
                    .ok_or_else(|| source::invalid("amf", "unknown volume material"))
            })
            .transpose()?;
        let base = color(volume)?
            .or(object_color)
            .unwrap_or(material.map(|m| m.1).unwrap_or([1.0; 4]));
        let mut out = Vertices::default();
        for triangle in elements(volume, "triangle") {
            super::super::archive::check(request)?;
            *payload = payload
                .checked_add(132)
                .ok_or_else(|| source::invalid("amf", "geometry size overflow"))?;
            source::admit(*payload, request.ram_budget / 4, "amf")?;
            let indices = ["v1", "v2", "v3"]
                .map(|name| {
                    let text = xml::required(triangle, name, "amf")?
                        .text()
                        .unwrap_or("")
                        .trim();
                    text.parse::<usize>()
                        .map_err(|_| source::invalid("amf", "invalid vertex index"))
                })
                .into_iter()
                .collect::<Result<Vec<_>>>()?;
            let corners = indices
                .iter()
                .map(|&id| {
                    points
                        .get(id)
                        .ok_or_else(|| source::invalid("amf", "vertex index out of range"))
                })
                .collect::<Result<Vec<_>>>()?;
            let positions: Vec<[f64; 3]> = corners
                .iter()
                .map(|p| [p[0] as f64, p[1] as f64, p[2] as f64])
                .collect();
            let normal = normalise(cross(
                sub(positions[1], positions[0]),
                sub(positions[2], positions[0]),
            ))
            .unwrap_or([0.0; 3]);
            let face_color = color(triangle)?.unwrap_or(base);
            for (&index, position) in indices.iter().zip(corners) {
                out.indices.push(out.count() as u32);
                out.positions.extend_from_slice(position);
                out.normals.extend(normal.map(|v| v as f32));
                out.colors.extend(colors[index].unwrap_or(face_color));
            }
        }
        if out.indices.is_empty() {
            return Err(source::invalid("amf", "empty volume"));
        }
        let first: [f32; 4] = out.colors[..4].try_into().unwrap();
        let uniform = out.colors.as_chunks::<4>().0.iter().all(|c| *c == first);
        let rank = if uniform && material.is_some_and(|m| m.1 == first) {
            out.colors.clear();
            material.unwrap().0
        } else {
            let rank = scene.materials.len();
            let mut surface = source::material(
                &format!("object-{id}-volume-{volume_rank}"),
                if uniform { first } else { [1.0; 4] },
            );
            // An override is a geometry material variant, still identified by its authored source.
            surface["extras"] = json!({"amfMaterial":declared,"amfVolume":volume_rank});
            if out.colors.as_chunks::<4>().0.iter().any(|c| c[3] < 1.0) {
                surface["alphaMode"] = json!("BLEND");
            }
            if uniform {
                out.colors.clear();
            }
            scene.materials.push(surface);
            rank
        };
        parts.push((out, Some(rank)));
    }
    source::mesh(scene, &format!("object-{id}"), &parts)
}
