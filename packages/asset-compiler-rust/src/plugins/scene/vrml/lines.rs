//! IndexedLineSet becomes actual segments, retaining polyline and colour binding order.
use super::attributes::{indices, positions, Attribute};
use super::*;
pub(super) fn geometry(
    node: &document::Node,
    document: &document::Document,
    material: usize,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<usize> {
    node.fields(&[
        "coord",
        "coordIndex",
        "color",
        "colorIndex",
        "colorPerVertex",
    ])?;
    let positions = positions(node, document)?;
    let lines = indices(node.numbers("coordIndex")?)?;
    let colors = Attribute::new(node, document, "color", "Color", "color", 3)?;
    let mut out = Vertices::default();
    for (rank, line) in lines.iter().enumerate() {
        super::super::archive::check(request)?;
        if line.len() < 2 {
            return Err(source::invalid("vrml", "polyline needs two coordinates"));
        }
        for pair in 0..line.len() - 1 {
            source::admit(
                (out.count() + 2).saturating_mul(32),
                request.ram_budget / 4,
                "vrml",
            )?;
            for corner in [pair, pair + 1] {
                let index = line[corner];
                let point = positions
                    .get(index * 3..index * 3 + 3)
                    .ok_or_else(|| source::invalid("vrml", "line coordinate out of bounds"))?;
                out.indices.push(out.count() as u32);
                for value in point {
                    out.positions.push(source::finite(*value, "vrml")?);
                }
                if let Some(colors) = &colors {
                    for value in colors.corner(rank, corner, index)? {
                        if !(0. ..=1.).contains(value) {
                            return Err(source::invalid("vrml", "colour outside [0,1]"));
                        }
                        out.colors.push(*value as f32);
                    }
                    out.colors.push(1.);
                }
            }
        }
    }
    if out.indices.is_empty() {
        return Err(source::invalid("vrml", "empty IndexedLineSet"));
    }
    let surface = &mut scene.materials[material];
    // VRML97 6.13: lines ignore lighting, transparency and textures.
    let rgb = if colors.is_some() || surface["emissiveFactor"].is_null() {
        json!([1., 1., 1.])
    } else {
        surface["emissiveFactor"].clone()
    };
    surface["pbrMetallicRoughness"]["baseColorFactor"] = json!([rgb[0], rgb[1], rgb[2], 1.]);
    surface["alphaMode"] = json!("OPAQUE");
    surface["extensions"]["KHR_materials_unlit"] = json!({});
    let mut primitive =
        crate::import::primitive(&out, &mut scene.bin, &mut scene.accessors, Some(material));
    primitive["mode"] = json!(1);
    let rank = scene.meshes.len();
    scene.meshes.push(
        json!({"name":node.name.as_deref().unwrap_or("IndexedLineSet"),"primitives":[primitive]}),
    );
    scene.mesh_triangles.push(0);
    Ok(rank)
}
