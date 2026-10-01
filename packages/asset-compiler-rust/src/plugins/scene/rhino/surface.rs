//! Recover local meshes from the codec's expanded instances, then keep their affine placements.
use super::*;
use cadmpeg_ir::tessellation::{Tessellation, TessellationChannelDomain};
fn vertices(
    mesh: &Tessellation,
    inverse: Transform,
    request: &SceneRequest<'_>,
) -> Result<Vertices> {
    if !mesh.corner_normals.is_empty() || !mesh.texture_assignments.is_empty() {
        return Err(source::unsupported(
            "3dm",
            "corner normal or face-texture binding",
        ));
    }
    let mut out = Vertices::default();
    for (index, vertex) in mesh.vertices.iter().enumerate() {
        decode::check(request, index)?;
        let point = inverse.apply_point(*vertex);
        for value in [point.x, point.y, point.z] {
            out.positions.push(source::finite(value * 0.001, "3dm")?);
        }
    }
    for (index, normal) in mesh.normals.iter().enumerate() {
        decode::check(request, index)?;
        let n = inverse
            .apply_normal(*normal)
            .ok_or_else(|| source::invalid("3dm", "singular normal placement"))?;
        for value in [n.x, n.y, n.z] {
            out.normals.push(source::finite(value, "3dm")?);
        }
    }
    for (index, triangle) in mesh.triangles.iter().enumerate() {
        decode::check(request, index)?;
        out.indices.extend(triangle);
    }
    for channel in &mesh.channels {
        if channel.domain != TessellationChannelDomain::Vertex
            || channel.count as usize != mesh.vertices.len()
            || !channel.indices.is_empty()
        {
            return Err(source::unsupported("3dm", "non-vertex mesh channel"));
        }
        match (channel.kind, channel.item_size) {
            (0x5248_0001, 8) => {
                for bytes in channel.data.as_chunks::<4>().0.iter() {
                    out.uvs
                        .push(source::finite(f32::from_le_bytes(*bytes) as f64, "3dm")?);
                }
            }
            (0x5248_0002, 4) => {
                for bytes in channel.data.as_chunks::<4>().0.iter() {
                    let mut color = source::linear_color([
                        bytes[0] as f32 / 255.,
                        bytes[1] as f32 / 255.,
                        bytes[2] as f32 / 255.,
                        1.0,
                    ]);
                    color[3] = 1.0 - bytes[3] as f32 / 255.;
                    out.colors.extend(color);
                }
            }
            // Curvature, surface parameters and native n-gon grouping do not change the surface.
            (0x5248_0003..=0x5248_0005, _) => {}
            _ => return Err(source::unsupported("3dm", "unknown mesh channel")),
        }
    }
    Ok(out)
}
pub(super) fn emit(
    ir: &CadIr,
    metadata: &metadata::Metadata,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<()> {
    let cost = ir.model.tessellations.iter().fold(0usize, |sum, m| {
        sum.saturating_add(m.vertices.len().saturating_mul(192))
            .saturating_add(m.triangles.len().saturating_mul(64))
    });
    source::admit(cost, request.ram_budget / 4, "3dm")?;
    let mut mesh_cache = BTreeMap::new();
    let mut material_cache = BTreeMap::new();
    let mut children = Vec::new();
    for (index, mesh) in ir.model.tessellations.iter().enumerate() {
        decode::check(request, index)?;
        if mesh.triangles.is_empty() {
            continue;
        }
        let association = mesh
            .source_object
            .as_ref()
            .ok_or_else(|| source::unsupported("3dm", "mesh without source identity"))?;
        let transform = metadata.placement(association)?;
        let inverse = transform
            .try_inverse_affine()
            .ok_or_else(|| source::unsupported("3dm", "singular instance"))?;
        let material = materials::resolve(association, metadata, &mut material_cache, scene)?;
        let key = (association.object_id.clone(), material);
        let rank = if let Some(rank) = mesh_cache.get(&key) {
            *rank
        } else {
            let vertices = vertices(mesh, inverse, request)?;
            let rank = source::mesh(scene, &association.object_id, &[(vertices, Some(material))])?;
            mesh_cache.insert(key, rank);
            rank
        };
        let mut matrix = [0.0; 16];
        for col in 0..4 {
            for row in 0..4 {
                matrix[col * 4 + row] = transform.rows[row][col];
            }
        }
        for value in &mut matrix[12..15] {
            *value *= 0.001;
        }
        let mut node = json!({"name":association.name.as_deref().unwrap_or(&association.object_id),"mesh":rank,"matrix":matrix,"extras":{"rhinoObjectId":association.object_id,"rhinoInstancePath":association.instance_path}});
        if association.visible == Some(false) {
            node["extensions"] = json!({"KHR_node_visibility":{"visible":false}});
        }
        children.push(scene.node(node));
    }
    scene.node(
        json!({"name":"Rhino","matrix":[1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1],"children":children}),
    );
    Ok(())
}
