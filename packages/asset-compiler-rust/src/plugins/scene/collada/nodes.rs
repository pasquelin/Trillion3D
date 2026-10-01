//! Ordered node transforms, instancing and the document's declared coordinate system.
use super::*;
use crate::compiler_world::{axis_angle, multiply, scaling, translation, Mat4, IDENTITY};
fn tuple<const N: usize>(node: Node<'_, '_>) -> Result<[f64; N]> {
    xml::numbers(node, "collada")?.try_into().map_err(|_| {
        source::invalid(
            "collada",
            format!("{} needs {N} numbers", node.tag_name().name()),
        )
    })
}
pub(super) fn root_matrix(root: Node<'_, '_>) -> Result<Mat4> {
    let asset = xml::child(root, "asset");
    let meter = asset
        .and_then(|a| xml::child(a, "unit"))
        .and_then(|u| u.attribute("meter"))
        .unwrap_or("1")
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && *v > 0.0)
        .ok_or_else(|| source::invalid("collada", "invalid metre unit"))?;
    let up = asset
        .and_then(|a| xml::child(a, "up_axis"))
        .and_then(|n| n.text())
        .unwrap_or("Y_UP")
        .trim();
    let rotation = match up {
        "Y_UP" => IDENTITY,
        "Z_UP" => axis_angle([1., 0., 0.], -std::f64::consts::FRAC_PI_2),
        "X_UP" => axis_angle([0., 0., 1.], std::f64::consts::FRAC_PI_2),
        _ => return Err(source::unsupported("collada", format!("up_axis {up}"))),
    };
    Ok(multiply(&rotation, &scaling([meter; 3])))
}
fn transform(node: Node<'_, '_>) -> Result<Mat4> {
    let mut matrix = IDENTITY;
    for entry in node.children().filter(|n| n.is_element()) {
        let next = match entry.tag_name().name() {
            "translate" => translation(tuple(entry)?),
            "scale" => scaling(tuple(entry)?),
            "rotate" => {
                let [x, y, z, degrees] = tuple(entry)?;
                let axis = crate::shared_math::unit([x, y, z])
                    .ok_or_else(|| source::invalid("collada", "zero rotation axis"))?;
                axis_angle(axis, degrees.to_radians())
            }
            "matrix" => {
                let written = tuple::<16>(entry)?;
                std::array::from_fn(|i| written[(i % 4) * 4 + i / 4])
            }
            "lookat" | "skew" => {
                return Err(source::unsupported("collada", entry.tag_name().name()))
            }
            _ => continue,
        };
        matrix = multiply(&matrix, &next);
        if !matrix.iter().all(|v| v.is_finite()) {
            return Err(source::invalid("collada", "transform overflow"));
        }
    }
    Ok(matrix)
}
pub(super) fn emit(
    world: &mut World<'_, '_, '_>,
    node: Node<'_, '_>,
    depth: usize,
) -> Result<usize> {
    if depth >= 256 {
        return Err(source::invalid(
            "collada",
            "node hierarchy exceeds256 levels or cycles",
        ));
    }
    super::super::archive::check(world.request)?;
    let matrix = transform(node)?;
    let mut children = Vec::new();
    for entry in node.children().filter(|n| n.is_element()) {
        match entry.tag_name().name() {
            "node" => children.push(emit(world, entry, depth + 1)?),
            "instance_node" => {
                let referenced = world.lookup(entry.attribute("url").unwrap_or(""))?;
                if !referenced.has_tag_name("node") {
                    return Err(source::invalid(
                        "collada",
                        "instance_node target is not a node",
                    ));
                }
                children.push(emit(world, referenced, depth + 1)?);
            }
            "instance_geometry" => {
                let mesh = geometry::instance(world, entry)?;
                children.push(world.scene.node(json!({"mesh":mesh})));
            }
            "instance_controller" | "instance_camera" | "instance_light" => {
                return Err(source::unsupported("collada", entry.tag_name().name()))
            }
            _ => {}
        }
    }
    Ok(world.scene.node(json!({"name":node.attribute("name").or_else(||node.attribute("id")).unwrap_or("node"),"matrix":matrix,"children":children})))
}
