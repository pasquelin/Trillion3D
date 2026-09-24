//! The bodies a source declares (`KHR_physics_rigid_bodies`, `KHR_implicit_shapes`). Nothing is
//! guessed: a node that declares nothing is static and collides through its mesh's tiles; a node
//! that declares motion is a moving body, taken out of the static tiles; its shape is the implicit
//! shape it names, the hull of the mesh it names, or — declared dynamic without any shape — a
//! convex decomposition of its own mesh (`decompose.rs`), with mass, centre of mass and inertia
//! computed here, at cook time.
use super::{cut::store_shape, decompose::decompose, hulls_shape};
use crate::{accessor, invalid, required_index, values, Options, Result};
use serde_json::{json, Value};

/// Density a body without a declared mass is weighed at, kg/m³: the runtime's (`commands.cpp`).
const DENSITY: f32 = 1000.0;

/// What a node declares, read from its extension; `None` when it declares nothing.
pub(crate) fn motion_of(node: &Value) -> Option<&Value> {
    node.pointer("/extensions/KHR_physics_rigid_bodies/motion")
}

/// An implicit shape as the runtime builds it: half extents, radii, half heights.
fn implicit(shape: &Value) -> Result<Value> {
    let number = |path: &str| shape.pointer(path).and_then(Value::as_f64);
    let kind = shape.get("type").and_then(Value::as_str).unwrap_or("");
    let round = |name: &str| {
        let top = number(&format!("/{name}/radiusTop")).unwrap_or(0.25);
        let bottom = number(&format!("/{name}/radiusBottom")).unwrap_or(0.25);
        let height = number(&format!("/{name}/height")).unwrap_or(0.5);
        json!({"type":name,"halfHeight":height*0.5,"radius":top.max(bottom)})
    };
    Ok(match kind {
        "box" => {
            let size = shape.pointer("/box/size").and_then(Value::as_array);
            let half: Vec<f64> = (0..3)
                .map(|k| {
                    size.and_then(|s| s.get(k))
                        .and_then(Value::as_f64)
                        .unwrap_or(1.0)
                        * 0.5
                })
                .collect();
            json!({"type":"box","halfExtents":half})
        }
        "sphere" => json!({"type":"sphere","radius":number("/sphere/radius").unwrap_or(0.5)}),
        "capsule" | "cylinder" => round(kind),
        other => {
            return Err(invalid(format!(
                "Unsupported implicit shape type \"{other}\""
            )))
        }
    })
}

/// Level-0 positions and triangles of every triangle primitive of mesh `mesh`.
fn mesh_triangles(g: &Value, bin: &[u8], mesh: usize) -> Result<(Vec<f32>, Vec<u32>)> {
    let (mut pos, mut triangles) = (Vec::new(), Vec::new());
    let primitives = values(&values(g, "meshes")?[mesh], "primitives")?;
    for p in primitives {
        let base = (pos.len() / 3) as u32;
        let id = required_index(p.pointer("/attributes/POSITION"), "POSITION")?;
        let positions = accessor(g, bin, id, None)?;
        pos.extend(positions.collect_f32()?);
        let local: Vec<u32> = match p.get("indices") {
            Some(index) => {
                accessor(g, bin, required_index(Some(index), "indices")?, None)?.collect_u32()?
            }
            None => (0..positions.count as u32).collect(),
        };
        triangles.extend(local.iter().map(|i| i + base));
    }
    Ok((pos, triangles))
}

/// The cooked hulls of a mesh — one hull, or a decomposition — with their mass properties.
fn cooked(o: &Options, g: &Value, bin: &[u8], mesh: usize, one_hull: bool) -> Result<Value> {
    let (pos, triangles) = mesh_triangles(g, bin, mesh)?;
    // The concavity allowed is the mesh's own grain: its mean edge length.
    let edges = triangles
        .chunks_exact(3)
        .flat_map(|t| [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])]);
    let (sum, count) = edges.fold((0.0f64, 0usize), |(sum, count), (a, b)| {
        let d = (0..3).map(|k| (pos[a as usize * 3 + k] - pos[b as usize * 3 + k]) as f64);
        (sum + d.map(|v| v * v).sum::<f64>().sqrt(), count + 1)
    });
    let tolerance = sum / count.max(1) as f64;
    let parts = if one_hull {
        vec![pos.clone()]
    } else {
        decompose(&pos, &triangles, tolerance)
    };
    let (bytes, mass) = hulls_shape(&parts, DENSITY)?;
    let mut shape = store_shape(o, &bytes)?;
    shape["type"] = json!("cooked");
    shape["parts"] = json!(parts.len());
    shape["tolerance"] = json!(tolerance);
    shape["mass"] = json!({"mass":mass.mass,"centerOfMass":mass.centre,"inertia":mass.inertia});
    Ok(shape)
}

/// The body node `index` declares, or `None`: its type, shape, material and mass.
pub(crate) fn declared_body(
    o: &Options,
    g: &Value,
    bin: &[u8],
    index: usize,
) -> Result<Option<Value>> {
    let node = &values(g, "nodes")?[index];
    let Some(declared) = node.pointer("/extensions/KHR_physics_rigid_bodies") else {
        return Ok(None);
    };
    let motion = declared.get("motion");
    let kinematic = motion
        .and_then(|m| m.get("isKinematic"))
        .and_then(Value::as_bool)
        == Some(true);
    let kind = match (motion, kinematic) {
        (None, _) => "static",
        (Some(_), true) => "kinematic",
        _ => "dynamic",
    };
    let geometry = declared.pointer("/collider/geometry");
    let shape = if let Some(id) = geometry
        .and_then(|g| g.get("shape"))
        .and_then(Value::as_u64)
    {
        let shapes = g
            .pointer("/extensions/KHR_implicit_shapes/shapes")
            .and_then(Value::as_array);
        let shape = shapes.and_then(|s| s.get(id as usize));
        implicit(shape.ok_or_else(|| invalid("Collider names a missing implicit shape"))?)?
    } else {
        let at = geometry.and_then(|g| g.get("node")).and_then(Value::as_u64);
        let owner = &values(g, "nodes")?[at.map_or(index, |n| n as usize)];
        let Some(mesh) = owner.get("mesh").and_then(Value::as_u64) else {
            return Ok(None);
        };
        // A static mesh collider is the static tiles already; a moving one needs hulls.
        if kind == "static" {
            return Ok(None);
        }
        let hull = geometry
            .and_then(|g| g.get("convexHull"))
            .and_then(Value::as_bool)
            == Some(true);
        cooked(o, g, bin, mesh as usize, hull)?
    };
    let material = declared
        .pointer("/collider/physicsMaterial")
        .and_then(Value::as_u64)
        .and_then(|m| {
            g.pointer(&format!(
                "/extensions/KHR_physics_rigid_bodies/physicsMaterials/{m}"
            ))
        });
    let number =
        |v: Option<&Value>, key: &str| v.and_then(|v| v.get(key)).cloned().unwrap_or(Value::Null);
    Ok(Some(json!({
        "node":index,"type":kind,"shape":shape,
        "mass":number(motion, "mass"),"gravityFactor":number(motion, "gravityFactor"),
        "friction":number(material, "dynamicFriction"),"restitution":number(material, "restitution"),
    })))
}
