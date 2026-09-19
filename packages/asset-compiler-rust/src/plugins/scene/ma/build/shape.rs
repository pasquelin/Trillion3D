//! Shapes of a `transform`: those that enter the scene, and what the file does not put there.
//!
//! A Maya `mesh` node is not always a surface to draw. An **intermediate** shape is the input
//! of a construction history — the original box under the deformation that bends it —, which
//! Maya never displays; a shape whose visibility is off is hidden by the file itself.
//! Emitting either would make geometry appear that the scene hides.
use super::*;

/// glTF meshes this transform carries: its child shapes, then those a `parent -add` hangs
/// on it. Each shape is built only once, whatever the number of transforms that cite it.
pub(super) fn shapes(world: &mut World<'_>, node: usize) -> Vec<usize> {
    let own: Vec<usize> = world.kids[node]
        .iter()
        .copied()
        .filter(|shape| report::is_mesh(&world.document.nodes[*shape].kind))
        .collect();
    let added = world.added[node].clone();
    let mut out = Vec::new();
    for shape in own.into_iter().chain(added) {
        if drawn(world, shape) {
            out.extend(mesh::build(world, shape));
        }
    }
    out
}

/// Does this shape enter the scene? An intermediate shape and an invisible shape are each
/// counted under their name, and neither is converted.
fn drawn(world: &mut World<'_>, shape: usize) -> bool {
    let document = world.document;
    let flag = |names: &[&str]| document.nodes[shape].attr(names).and_then(Attr::flag);
    let intermediate = flag(&["io", "intermediateObject"]) == Some(true);
    let hidden = flag(&["v", "visibility"]) == Some(false);
    if intermediate {
        world.refuse(report::SHAPE_INTERMEDIATE);
    } else if hidden {
        world.scene.count("invisible", 1);
    }
    !intermediate && !hidden
}

/// Counts, by its type, each node this driver does not convert: cameras, lights, parametric
/// surfaces, skeletons, tool nodes, script nodes. None of that is a failure.
pub(super) fn ignored(world: &mut World<'_>) {
    let document = world.document;
    for node in document.nodes.iter().filter(|node| {
        !report::is_transform(&node.kind) && !report::is_mesh(&node.kind) && !shades(&node.kind)
    }) {
        world
            .scene
            .report
            .add(&format!("{}:{}", report::NODE_IGNORED, node.kind));
    }
}

/// Does this node describe shading — a shader, a set, an image, a placement? These nodes do
/// not enter the hierarchy: materials read them, and they are therefore not counted.
fn shades(kind: &str) -> bool {
    report::is_shader(kind)
        || matches!(
            kind,
            "shadingEngine" | "file" | "place2dTexture" | "bump2d" | "materialInfo" | "groupId"
        )
}
