//! Splitting a surface into material parts, and the glTF primitive each one yields.
//!
//! A `shadingEngine` claims either the whole mesh, or the faces its component list names. A
//! whole binding therefore takes only what no per-face binding has taken: that is how a mesh
//! with several materials yields several primitives, without any face being drawn twice.
//!
//! A glTF primitive carries its attributes for all its vertices or for none. A part of which
//! only one face carries texture coordinates therefore carries none, and the mismatch is
//! counted: giving `(0, 0)` to the others would invent a mapping the file does not write. What
//! a face corner becomes is read in `corner`.
use super::*;
use crate::import::Vertices;
use crate::plugins::scene::ngon::Ngon;

/// A material part: its glTF material, and the faces it carries.
struct Part {
    material: Option<usize>,
    faces: Vec<usize>,
}

/// Writes the surface primitives and places the mesh in the table.
pub(super) fn emit(world: &mut World<'_>, node: usize, surface: &Surface) -> Option<usize> {
    let mut primitives = Vec::new();
    let mut triangles = 0usize;
    for part in parts(world, node, surface.loops.len()) {
        let Some((value, count)) = build(world, surface, &part) else {
            continue;
        };
        triangles += count;
        primitives.push(value);
    }
    if primitives.is_empty() {
        world.refuse(report::MESH_EMPTY);
        return None;
    }
    let name = world.document.nodes[node].name.clone();
    world
        .scene
        .meshes
        .push(json!({"name":name,"primitives":primitives}));
    world.scene.mesh_triangles.push(triangles);
    Some(world.scene.meshes.len() - 1)
}

/// Parts of this mesh. With no binding, a single part without a material carries every face: a
/// mesh that no set shades stays visible.
fn parts(world: &mut World<'_>, node: usize, faces: usize) -> Vec<Part> {
    let binds: Vec<(Option<usize>, Option<Vec<usize>>)> = world
        .graph
        .binds
        .get(&node)
        .map(|binds| {
            binds
                .iter()
                .map(|bind| (bind.shader, bind.faces.clone()))
                .collect()
        })
        .unwrap_or_default();
    if binds.is_empty() {
        return vec![Part {
            material: None,
            faces: (0..faces).collect(),
        }];
    }
    let mut taken = vec![false; faces];
    let mut out = Vec::with_capacity(binds.len());
    for (shader, named) in binds.iter().filter(|(_, named)| named.is_some()) {
        let owned = named
            .iter()
            .flatten()
            .filter(|face| **face < faces && !std::mem::replace(&mut taken[**face], true))
            .copied()
            .collect();
        let material = shader.and_then(|shader| material::resolve(world, shader));
        out.push(Part {
            material,
            faces: owned,
        });
    }
    let rest: Vec<usize> = (0..faces).filter(|face| !taken[*face]).collect();
    // What no per-face binding has taken goes back to the whole binding when there is one, and
    // otherwise comes out without a material: a face the file writes is a face of the scene.
    let whole = binds.iter().find(|(_, named)| named.is_none());
    if whole.is_none() {
        world
            .scene
            .report
            .add_count(report::FACE_MATERIAL_MISSING, rest.len());
    }
    let material = whole
        .and_then(|(shader, _)| *shader)
        .and_then(|shader| material::resolve(world, shader));
    if whole.is_some() || !rest.is_empty() {
        out.push(Part {
            material,
            faces: rest,
        });
    }
    out
}

/// A part as a glTF primitive, with its triangle count.
fn build(world: &mut World<'_>, surface: &Surface, part: &Part) -> Option<(Value, usize)> {
    let carried = |face: &usize| surface.uv_slots.get(*face).is_some_and(|uv| !uv.is_empty());
    let textured = !surface.uvs.is_empty() && part.faces.iter().all(carried);
    if !textured && !surface.uvs.is_empty() {
        world.refuse(report::UV_DROPPED);
    }
    let mut out = Vertices::default();
    let mut unique: HashMap<[u32; 3], u32> = HashMap::new();
    let mut cutter = Ngon::default();
    let cancelled = world.cancelled;
    for face in &part.faces {
        let ring = surface.loops.get(*face).map_or(0, Vec::len);
        if ring < 3 {
            continue;
        }
        let corners: Vec<u32> = (0..ring)
            .filter_map(|rank| surface.corner(&mut out, &mut unique, (*face, rank), textured))
            .collect();
        if corners.len() != ring {
            continue;
        }
        // The cutter rereads the token per face slice: a single huge mesh stops too. What is
        // already placed stays, and `convert` then refuses the whole scene.
        match surface.cut(&mut cutter, *face, cancelled) {
            None => break,
            Some(false) => world.refuse(report::NGON_UNCUT),
            Some(true) => {}
        }
        for [a, b, c] in cutter.triangles() {
            out.indices.extend([corners[*a], corners[*b], corners[*c]]);
        }
    }
    world.scene.part_primitive(&out, part.material)
}
