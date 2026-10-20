//! A USD `Mesh` into a glTF mesh: the required tables, the split into material parts, and the
//! identity that lets an instance reuse its prototype's mesh.
use super::*;

/// Builds the mesh of a `Mesh` prim, or finds it again when an instance already did. `key` is
/// the data path — the prototype's for an instance — and makes, with the material list, the
/// identity of the shared mesh.
pub(super) fn build(world: &mut World<'_>, prim: &usd::Prim, key: &str) -> Option<usize> {
    let points = array(world, prim, "points", read::triples)?;
    let counts = array(world, prim, "faceVertexCounts", read::integers)?;
    let corners = array(world, prim, "faceVertexIndices", read::integers)?;
    let Some(faces) = spans(&counts, corners.len()) else {
        world
            .scene
            .report
            .add(crate::plugins::scene::codes::MESH_INVALID);
        return None;
    };
    if points.is_empty() || faces.is_empty() {
        world
            .scene
            .report
            .add(crate::plugins::scene::codes::MESH_INVALID);
        return None;
    }
    if read::text_attribute(prim, "subdivisionScheme")
        .as_deref()
        .unwrap_or("catmullClark")
        != "none"
    {
        world.scene.report.add(world::SUBDIVISION);
    }
    let double_sided = read::first(&prim.attribute("doubleSided"))
        .and_then(|(value, _)| read::flag(&value))
        .unwrap_or(false);
    let holes = holes(world, prim, faces.len());
    let parts = subset::parts(world, prim, faces.len(), double_sided);
    let identity = (
        key.to_string(),
        parts.iter().map(|part| part.material).collect::<Vec<_>>(),
    );
    if let Some(known) = world.meshes.get(&identity) {
        return Some(*known);
    }
    let surface = surface::Surface::read(world, prim, points, corners, faces, holes);
    emit(world, prim, &surface, &parts, identity)
}

/// Writes the primitives of each part and places the mesh in the table.
fn emit(
    world: &mut World<'_>,
    prim: &usd::Prim,
    surface: &surface::Surface,
    parts: &[subset::Part],
    identity: (String, Vec<Option<usize>>),
) -> Option<usize> {
    let built = parts
        .iter()
        .filter_map(|part| surface.part(world, part))
        .collect();
    let name = prim.path().name().unwrap_or("Mesh");
    let invalid = crate::plugins::scene::codes::MESH_INVALID;
    let mesh = world.scene.mesh_of_parts(name, built, invalid)?;
    world.meshes.insert(identity, mesh);
    Some(mesh)
}

/// Rank of the first corner of each face and its corner count, or `None` when the counts do not
/// fall on the index table: a mesh that contradicts itself is not interpreted.
fn spans(counts: &[i64], corners: usize) -> Option<Vec<(usize, usize)>> {
    let mut out = Vec::with_capacity(counts.len());
    let mut start = 0usize;
    for count in counts {
        let count = usize::try_from(*count).ok()?;
        out.push((start, count));
        start = start.checked_add(count)?;
    }
    (start == corners).then_some(out)
}

/// A required mesh array, counted as invalid when it is missing or does not convert.
fn array<T>(
    world: &mut World<'_>,
    prim: &usd::Prim,
    name: &str,
    decode: impl Fn(&sdf::Value) -> Option<Vec<T>>,
) -> Option<Vec<T>> {
    let Some(value) = world.first(prim, name) else {
        world
            .scene
            .report
            .add(crate::plugins::scene::codes::MESH_INVALID);
        return None;
    };
    match decode(&value) {
        Some(values) => Some(values),
        None => {
            world
                .scene
                .report
                .add(crate::plugins::scene::codes::MESH_INVALID);
            None
        }
    }
}

/// Faces that `holeIndices` names. OpenUSD renders them invisible, and the subdivision scheme
/// changes nothing: an invisible face is so before any subdivision. Each removed face is counted
/// once — a repeated index removes only one face — and an index that leaves the face table is
/// counted as any face a mesh declares and that its tables do not carry.
fn holes(world: &mut World<'_>, prim: &usd::Prim, faces: usize) -> BTreeSet<usize> {
    let mut out = BTreeSet::new();
    let Some(value) = world.first(prim, "holeIndices") else {
        return out;
    };
    let Some(indices) = read::integers(&value) else {
        world
            .scene
            .report
            .add(crate::plugins::scene::codes::MESH_INVALID);
        return out;
    };
    for index in indices {
        match usize::try_from(index).ok().filter(|face| *face < faces) {
            Some(face) if out.insert(face) => world.scene.report.add(world::FACE_HOLE),
            Some(_) => {}
            None => world.scene.report.add(world::FACE_INVALID),
        }
    }
    out
}
