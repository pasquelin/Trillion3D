//! Opaque neighbours hide internal faces; transparent interfaces retain both boundaries.
use super::*;
pub(super) fn emit(
    model: &Model,
    index: usize,
    materials: &BTreeMap<u8, usize>,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<Option<usize>> {
    if model.voxels.is_empty() {
        return Ok(None);
    }
    let mut occupied = HashMap::with_capacity(model.voxels.len());
    for (index, voxel) in model.voxels.iter().enumerate() {
        if super::super::cancel::stopped(request.cancelled, index) {
            return Err(super::super::cancel::refusal());
        }
        let key = [voxel[0] as i16, voxel[1] as i16, voxel[2] as i16];
        if occupied.insert(key, voxel[3]).is_some() {
            return Err(source::invalid("vox", "duplicate voxel position"));
        }
    }
    let mut parts: BTreeMap<u8, Vertices> = BTreeMap::new();
    for (index, voxel) in model.voxels.iter().enumerate() {
        if super::super::cancel::stopped(request.cancelled, index) {
            return Err(super::super::cancel::refusal());
        }
        let here = [voxel[0] as i16, voxel[1] as i16, voxel[2] as i16];
        for axis in 0..3 {
            for sign in [-1, 1] {
                let mut neighbour = here;
                neighbour[axis] += sign;
                if occupied.get(&neighbour).is_some_and(|other| {
                    opaque(&scene.materials[materials[other]])
                        && opaque(&scene.materials[materials[&voxel[3]]])
                }) {
                    continue;
                }
                let vertices = parts.entry(voxel[3]).or_default();
                let start = vertices.count() as u32;
                let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
                for corner in [[0, 0], [1, 0], [1, 1], [0, 1]] {
                    let mut p = here.map(|v| v as f32);
                    p[axis] += if sign > 0 { 1.0 } else { 0.0 };
                    p[u] += corner[0] as f32;
                    p[v] += corner[1] as f32;
                    for (i, coord) in p.iter_mut().enumerate() {
                        *coord -= model.size[i] as f32 * 0.5;
                    }
                    vertices.positions.extend(p);
                    let mut normal = [0.0; 3];
                    normal[axis] = sign as f32;
                    vertices.normals.extend(normal);
                }
                let order = if sign > 0 {
                    [0, 1, 2, 0, 2, 3]
                } else {
                    [0, 2, 1, 0, 3, 2]
                };
                vertices.indices.extend(order.map(|i| start + i));
            }
        }
    }
    let parts: Vec<_> = parts
        .into_iter()
        .map(|(slot, vertices)| (vertices, Some(materials[&slot])))
        .collect();
    Ok(Some(source::mesh(
        scene,
        &format!("model-{index}"),
        &parts,
    )?))
}

fn opaque(material: &serde_json::Value) -> bool {
    material["alphaMode"] == "OPAQUE"
        && material["extensions"]["KHR_materials_transmission"]["transmissionFactor"]
            .as_f64()
            .unwrap_or(0.0)
            == 0.0
}
