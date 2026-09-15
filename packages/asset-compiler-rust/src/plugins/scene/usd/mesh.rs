//! Un `Mesh` USD vers un maillage glTF : les tableaux obligatoires, le découpage en parties de
//! matériau, et l'identité qui fait qu'une instance réutilise le maillage de son prototype.
use super::*;

/// Construit le maillage d'un prim `Mesh`, ou le retrouve quand une instance l'a déjà fait. `key`
/// est le chemin de la donnée — celui du prototype pour une instance — et fait, avec la liste des
/// matériaux, l'identité du maillage partagé.
pub(super) fn build(world: &mut World<'_>, prim: &usd::Prim, key: &str) -> Option<usize> {
    let points = array(world, prim, "points", read::triples)?;
    let counts = array(world, prim, "faceVertexCounts", read::integers)?;
    let corners = array(world, prim, "faceVertexIndices", read::integers)?;
    let Some(faces) = spans(&counts, corners.len()) else {
        world.refuse(world::MESH_INVALID);
        return None;
    };
    if points.is_empty() || faces.is_empty() {
        world.refuse(world::MESH_INVALID);
        return None;
    }
    if scheme(prim, "subdivisionScheme")
        .as_deref()
        .unwrap_or("catmullClark")
        != "none"
    {
        world.refuse(world::SUBDIVISION);
    }
    let double_sided = read::first(&prim.attribute("doubleSided"))
        .and_then(|(value, _)| read::flag(&value))
        .unwrap_or(false);
    let parts = subset::parts(world, prim, faces.len(), double_sided);
    let identity = (
        key.to_string(),
        parts.iter().map(|part| part.material).collect::<Vec<_>>(),
    );
    if let Some(known) = world.meshes.get(&identity) {
        return Some(*known);
    }
    let surface = surface::Surface::read(world, prim, points, corners, faces);
    emit(world, prim, &surface, &parts, identity)
}

/// Écrit les primitives de chaque partie et pose le maillage dans la table.
fn emit(
    world: &mut World<'_>,
    prim: &usd::Prim,
    surface: &surface::Surface,
    parts: &[subset::Part],
    identity: (String, Vec<Option<usize>>),
) -> Option<usize> {
    let mut primitives = Vec::new();
    let mut triangles = 0usize;
    for part in parts {
        let Some((value, count)) = surface.part(world, part) else {
            continue;
        };
        triangles += count;
        primitives.push(value);
    }
    if primitives.is_empty() {
        world.refuse(world::MESH_INVALID);
        return None;
    }
    let name = prim.path().name().unwrap_or("Mesh").to_string();
    world
        .scene
        .meshes
        .push(json!({"name":name,"primitives":primitives}));
    world.scene.mesh_triangles.push(triangles);
    let mesh = world.scene.meshes.len() - 1;
    world.meshes.insert(identity, mesh);
    Some(mesh)
}

/// Le rang du premier coin de chaque face et son nombre de coins, ou `None` quand les comptes ne
/// tombent pas sur le tableau d'indices : un maillage qui se contredit n'est pas interprété.
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

/// Un tableau obligatoire du maillage, compté comme invalide quand il manque ou ne se convertit pas.
fn array<T>(
    world: &mut World<'_>,
    prim: &usd::Prim,
    name: &str,
    decode: impl Fn(&sdf::Value) -> Option<Vec<T>>,
) -> Option<Vec<T>> {
    let Some((value, sampled)) = read::first(&prim.attribute(name)) else {
        world.refuse(world::MESH_INVALID);
        return None;
    };
    if sampled {
        world.refuse(world::TIME_SAMPLE);
    }
    match decode(&value) {
        Some(values) => Some(values),
        None => {
            world.refuse(world::MESH_INVALID);
            None
        }
    }
}

/// Un attribut du maillage lu en texte — `subdivisionScheme`, `orientation`.
pub(super) fn scheme(prim: &usd::Prim, name: &str) -> Option<String> {
    read::first(&prim.attribute(name)).and_then(|(value, _)| read::text(&value))
}
