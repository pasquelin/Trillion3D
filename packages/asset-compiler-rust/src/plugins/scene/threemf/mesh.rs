//! Every triangle and its authored corner/property order becomes an existing glTF primitive.
use super::*;
pub(super) fn read(
    object: Node<'_, '_>,
    groups: &materials::Groups,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<usize> {
    let mesh = xml::required(object, "mesh", "3mf")?;
    let mut positions = Vec::new();
    for vertex in xml::required(mesh, "vertices", "3mf")?
        .children()
        .filter(|n| n.is_element())
    {
        if !vertex.has_tag_name("vertex") {
            return Err(source::unsupported("3mf", vertex.tag_name().name()));
        }
        source::admit(
            positions.len().saturating_add(1).saturating_mul(64),
            request.ram_budget / 4,
            "3mf",
        )?;
        positions.push([
            source::finite(number(vertex, "x")?, "3mf")?,
            source::finite(number(vertex, "y")?, "3mf")?,
            source::finite(number(vertex, "z")?, "3mf")?,
        ]);
    }
    let mut parts: Vec<(Vertices, Option<usize>)> = Vec::new();
    let mut count = 0usize;
    for triangle in xml::required(mesh, "triangles", "3mf")?
        .children()
        .filter(|n| n.is_element())
    {
        if !triangle.has_tag_name("triangle") {
            return Err(source::unsupported("3mf", triangle.tag_name().name()));
        }
        if super::super::cancel::stopped(request.cancelled, count) {
            return Err(super::super::cancel::refusal());
        }
        count += 1;
        source::admit(count.saturating_mul(256), request.ram_budget / 2, "3mf")?;
        let (material, colors) = materials::triangle(groups, object, triangle)?;
        if parts
            .last()
            .is_none_or(|p| p.1 != material || p.0.colors.is_empty() != colors.is_none())
        {
            parts.push((Vertices::default(), material));
        }
        let out = &mut parts.last_mut().unwrap().0;
        for (corner, key) in ["v1", "v2", "v3"].into_iter().enumerate() {
            let index = xml::usize_attribute(triangle, key, "3mf")?;
            let point = positions
                .get(index)
                .ok_or_else(|| source::invalid("3mf", "triangle vertex outside array"))?;
            out.indices.push(
                u32::try_from(out.count())
                    .map_err(|_| source::invalid("3mf", "too many corners"))?,
            );
            out.positions.extend(point);
            if let Some(colors) = colors {
                out.colors.extend(colors[corner]);
            }
        }
    }
    source::mesh_bounded(
        scene,
        object.attribute("name").unwrap_or("object"),
        &parts,
        request,
    )
}
