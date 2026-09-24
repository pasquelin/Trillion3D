//! `physics.json`, the cooked physics of a scene: the colliders of its primitives (tiles, their
//! objects, tolerance and measured error) and the static placements of those colliders by the nodes
//! that draw them, each with the matter its source declares. Its `formatVersion` is its own, and it
//! names the stage and the Jolt commit that cooked it: a reader refuses any other.
use super::declared::declared_matter;
use super::{
    JOLT_COMMIT, PHYSICS_COOK_STAGE, PHYSICS_COOK_VERSION, PHYSICS_FILE, PHYSICS_FORMAT_VERSION,
};
use crate::compiler_coplanar::DepthLayerScene;
use crate::compiler_world::{world_matrices, Mat4};
use crate::{product, required_index, values, Product, Result, COMPILER_VERSION};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// A node matrix as translation, rotation (x, y, z, w) and scale; `None` when it shears, which no
/// body pose can carry.
pub(crate) fn trs(m: &Mat4) -> Option<([f64; 3], [f64; 4], [f64; 3])> {
    let column = |c: usize| [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
    let length = |v: [f64; 3]| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    let (c0, c1, c2) = (column(0), column(1), column(2));
    let det = c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) - c1[0] * (c0[1] * c2[2] - c0[2] * c2[1])
        + c2[0] * (c0[1] * c1[2] - c0[2] * c1[1]);
    let s = [length(c0) * det.signum(), length(c1), length(c2)];
    if s.iter().any(|v| *v == 0.0 || !v.is_finite()) {
        return None;
    }
    let r: Vec<[f64; 3]> = [c0, c1, c2]
        .iter()
        .zip(s)
        .map(|(c, k)| c.map(|v| v / k))
        .collect();
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if dot(r[0], r[1])
        .abs()
        .max(dot(r[1], r[2]).abs())
        .max(dot(r[0], r[2]).abs())
        > 1e-4
    {
        return None;
    }
    // Rotation matrix to quaternion (Shoemake), columns `r[c]`, element (row, col) = r[col][row].
    let e = |row: usize, col: usize| r[col][row];
    let trace = e(0, 0) + e(1, 1) + e(2, 2);
    let q = if trace > 0.0 {
        let k = 0.5 / (trace + 1.0).sqrt();
        [
            (e(2, 1) - e(1, 2)) * k,
            (e(0, 2) - e(2, 0)) * k,
            (e(1, 0) - e(0, 1)) * k,
            0.25 / k,
        ]
    } else if e(0, 0) > e(1, 1) && e(0, 0) > e(2, 2) {
        let k = 2.0 * (1.0 + e(0, 0) - e(1, 1) - e(2, 2)).sqrt();
        [
            0.25 * k,
            (e(0, 1) + e(1, 0)) / k,
            (e(0, 2) + e(2, 0)) / k,
            (e(2, 1) - e(1, 2)) / k,
        ]
    } else if e(1, 1) > e(2, 2) {
        let k = 2.0 * (1.0 + e(1, 1) - e(0, 0) - e(2, 2)).sqrt();
        [
            (e(0, 1) + e(1, 0)) / k,
            0.25 * k,
            (e(1, 2) + e(2, 1)) / k,
            (e(0, 2) - e(2, 0)) / k,
        ]
    } else {
        let k = 2.0 * (1.0 + e(2, 2) - e(0, 0) - e(1, 1)).sqrt();
        [
            (e(0, 2) + e(2, 0)) / k,
            (e(1, 2) + e(2, 1)) / k,
            0.25 * k,
            (e(1, 0) - e(0, 1)) / k,
        ]
    };
    Some(([m[12], m[13], m[14]], q, s))
}

fn placed(mut entry: Value, m: &Mat4) -> Option<Value> {
    let (t, q, s) = trs(m)?;
    entry["position"] = json!(t);
    entry["rotation"] = json!(q);
    entry["scale"] = json!(s);
    Some(entry)
}

/// Colliders, each cooked primitive's slot among them, and the refused primitives.
pub(crate) type Gathered = (Vec<Value>, BTreeMap<usize, usize>, Vec<Value>);

/// The colliders of the cooked primitives, each primitive's slot among them, and the report's
/// entry of each primitive Jolt refused: its index, its mesh and primitive, and Jolt's reason.
pub(crate) fn gathered(primitives: &[Value], collisions: &[Value]) -> Gathered {
    let (mut colliders, mut slot, mut refused) = (Vec::new(), BTreeMap::new(), Vec::new());
    for (index, collision) in collisions.iter().enumerate().filter(|(_, c)| !c.is_null()) {
        let p = &primitives[index];
        if let Some(reason) = collision.get("refused") {
            refused.push(json!({"primitive":index,"mesh":p["mesh"],"meshPrimitive":p["primitive"],"reason":reason}));
            continue;
        }
        slot.insert(index, colliders.len());
        let mut entry = collision.clone();
        entry["primitive"] = json!(index);
        entry["material"] = p.get("material").cloned().unwrap_or(Value::Null);
        colliders.push(entry);
    }
    (colliders, slot, refused)
}

/// Writes `physics.json` from each primitive's collision (`cook_primitive`, `null` for one without
/// a DAG, `{"refused": reason}` for one Jolt refused); returns the product and the manifest's
/// `physics` descriptor, which names every object the file cites so a prune keeps them, and
/// carries the stage's report.
pub(crate) fn stage_physics(
    scene: &DepthLayerScene<'_>,
    primitives: &[Value],
    collisions: &[Value],
    directory: &Path,
) -> Result<(Product, Value)> {
    let DepthLayerScene {
        g,
        chosen,
        mesh_map,
        ..
    } = scene;
    let world = world_matrices(g)?;
    let nodes = values(g, "nodes")?;
    let (colliders, slot, refused) = gathered(primitives, collisions);
    let by_mesh = crate::proxy::primitives_by_mesh(primitives);
    let (mut instances, mut unplaced) = (Vec::new(), 0usize);
    // Every drawn node is static ground, as drawn: a node the source declares moving is placed
    // too, for no body simulates a node of a compiled model yet.
    for &node in chosen.iter() {
        let old = required_index(nodes[node].get("mesh"), "node.mesh")?;
        let Some(mesh) = mesh_map.get(&old) else {
            continue;
        };
        for index in by_mesh.get(&(*mesh as u64)).into_iter().flatten() {
            let Some(&collider) = slot.get(index) else {
                continue;
            };
            let mut entry = declared_matter(g, &nodes[node]);
            entry["node"] = json!(node);
            entry["collider"] = json!(collider);
            match placed(entry, &world[node]) {
                Some(entry) => instances.push(entry),
                None => unplaced += 1,
            }
        }
    }
    let largest = |key: &str| {
        colliders
            .iter()
            .filter_map(|c| c[key].as_f64())
            .fold(0.0, f64::max)
    };
    let triangles: u64 = colliders
        .iter()
        .filter_map(|c| c["triangles"].as_u64())
        .sum();
    let report = json!({"colliders":colliders.len(),"instances":instances.len(),"unplaced":unplaced,"triangles":triangles,"hausdorff":largest("hausdorff"),"tolerance":largest("tolerance"),"refused":refused});
    let document = json!({
        "formatVersion":PHYSICS_FORMAT_VERSION,"compilerVersion":COMPILER_VERSION,"jolt":JOLT_COMMIT,
        "stage":{"name":PHYSICS_COOK_STAGE,"version":PHYSICS_COOK_VERSION},
        "colliders":colliders,"instances":instances,"report":report,
    });
    let mut objects = BTreeSet::new();
    crate::compiler_prune::referenced_objects(&document, None, &mut objects)?;
    let written = product(directory, PHYSICS_FILE, &serde_json::to_vec(&document)?)?;
    let objects: Vec<Value> = objects
        .into_iter()
        .map(|sha| json!({"sha256":sha}))
        .collect();
    let descriptor = json!({"file":PHYSICS_FILE,"formatVersion":PHYSICS_FORMAT_VERSION,"jolt":JOLT_COMMIT,"report":report,"objects":objects});
    Ok((written, descriptor))
}
