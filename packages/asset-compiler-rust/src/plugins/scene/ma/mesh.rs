//! Un nœud `mesh` vers un maillage glTF : les tableaux écrits, les faces résolues par les arêtes,
//! et une primitive par matériau lié.
//!
//! Les polygones sont triangulés par oreilles dans le plan de leur normale, ce qui conserve l'aire
//! et la silhouette d'une face concave comme d'une face convexe. Une face qui déclare un trou est
//! laissée : le découpage le remplirait, et une silhouette ne se devine pas.
use super::*;
use crate::plugins::scene::ngon;

mod part;

/// Les tableaux d'une surface, lus une fois pour toutes ses parties.
pub(super) struct Surface {
    positions: Vec<[f64; 3]>,
    /// Les boucles de sommets de chaque face, déjà résolues depuis les arêtes.
    loops: Vec<Vec<u32>>,
    /// Les rangs d'UV de chaque coin, dans l'ordre des boucles ; vide quand la face n'en porte pas.
    uv_slots: Vec<Vec<i64>>,
    uvs: Vec<[f64; 2]>,
    normals: Vec<[f64; 3]>,
    /// Le rang du premier coin de chaque face dans le maillage entier, tel que `.fc` l'a écrit.
    bases: Vec<usize>,
    /// Où lire la normale d'un coin : par sommet, par coin du maillage, ou par face quand ce pilote
    /// les a calculées.
    shading: Shading,
}

/// La provenance des normales de cette surface.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Shading {
    Vertex,
    Corner,
    Face,
}

/// Construit le maillage de ce nœud, ou le retrouve quand un `parent -add` l'a déjà demandé.
pub(super) fn build(world: &mut World<'_>, node: usize) -> Option<usize> {
    if let Some(known) = world.meshes.get(&node) {
        return *known;
    }
    let built = read(world, node).and_then(|surface| part::emit(world, node, &surface));
    world.meshes.insert(node, built);
    built
}

/// Lit les tableaux du nœud et résout ses faces. Rien n'est construit tant qu'ils se contredisent.
fn read(world: &mut World<'_>, node: usize) -> Option<Surface> {
    let document = world.document;
    let mesh = &document.nodes[node];
    let Some(written) = mesh.attr(&["vt", "vrts"]) else {
        world.refuse(report::MESH_INVALID);
        return None;
    };
    let positions: Vec<[f64; 3]> = value::elements(written.numbers()).collect();
    let edges: Vec<[f64; 3]> =
        value::elements(mesh.attr(&["ed", "edge"]).map_or(&[][..], Attr::numbers)).collect();
    let polygons = mesh.attr(&["fc", "face"]).map_or(&[][..], Attr::faces);
    let uvs = value::elements(
        mesh.attr(&["uvst[0].uvsp", "uvSet[0].uvSetPoints"])
            .map_or(&[][..], Attr::numbers),
    )
    .collect();
    let bases: Vec<usize> = polygons
        .iter()
        .scan(0usize, |at, face| {
            let base = *at;
            *at = at.saturating_add(face.edges.len());
            Some(base)
        })
        .collect();
    let corners: usize = polygons.iter().map(|face| face.edges.len()).sum();
    if positions.is_empty() || polygons.is_empty() || corners > MAX_ELEMENTS {
        world.refuse(report::MESH_INVALID);
        return None;
    }
    let (loops, uv_slots) = resolve(world, polygons, &edges, positions.len());
    let (normals, shading) = shade(world, mesh, &positions, &loops, corners);
    Some(Surface {
        positions,
        loops,
        uv_slots,
        uvs,
        normals,
        bases,
        shading,
    })
}

/// La boucle de sommets de chaque face, et les rangs d'UV de ses coins. Une face dont une arête
/// sort de la table, ou dont un sommet sort de la table des positions, ne donne pas de boucle : elle
/// est comptée et laissée, plutôt que de rendre un triangle pris au hasard.
fn resolve(
    world: &mut World<'_>,
    polygons: &[faces::Face],
    edges: &[[f64; 3]],
    vertices: usize,
) -> (Vec<Vec<u32>>, Vec<Vec<i64>>) {
    let mut loops = Vec::with_capacity(polygons.len());
    let mut slots = Vec::with_capacity(polygons.len());
    for face in polygons {
        let ring: Option<Vec<u32>> = face
            .edges
            .iter()
            .map(|edge| corner(edges, *edge, vertices))
            .collect();
        match (ring, face.hole) {
            (_, true) => {
                world.refuse(report::FACE_HOLE);
                loops.push(Vec::new());
            }
            (None, _) => {
                world.refuse(report::MESH_INVALID);
                loops.push(Vec::new());
            }
            (Some(ring), _) if ring.len() < 3 => {
                world.refuse(report::DEGENERATE_FACE);
                loops.push(Vec::new());
            }
            (Some(ring), _) => loops.push(ring),
        }
        let carried = face.uv_set == 0 && face.uvs.len() == face.edges.len();
        if !carried && !face.uvs.is_empty() {
            world.refuse(report::UV_DROPPED);
        }
        slots.push(if carried {
            face.uvs.clone()
        } else {
            Vec::new()
        });
    }
    (loops, slots)
}

/// Le sommet de départ d'une arête signée. Maya écrit `-(i + 1)` pour une arête parcourue à
/// l'envers : le coin est alors le second sommet de l'arête `i`.
pub(super) fn corner(edges: &[[f64; 3]], signed: i64, vertices: usize) -> Option<u32> {
    let (rank, end) = match signed < 0 {
        true => (usize::try_from(-signed - 1).ok()?, 1),
        false => (usize::try_from(signed).ok()?, 0),
    };
    let vertex = usize::try_from(*edges.get(rank)?.get(end)? as i64).ok()?;
    (vertex < vertices)
        .then(|| u32::try_from(vertex).ok())
        .flatten()
}

/// Les normales de la surface et leur provenance. `.n` compte un vecteur par sommet ou un par coin ;
/// hors de ces deux tailles, elle est écartée. Sans normale écrite, elles sont calculées **à plat**,
/// une par face : Maya ne stocke pas les groupes de lissage d'une scène qu'il n'a pas évaluée, et
/// lisser sans eux inventerait une continuité que le fichier ne déclare pas.
fn shade(
    world: &mut World<'_>,
    mesh: &Node,
    positions: &[[f64; 3]],
    loops: &[Vec<u32>],
    corners: usize,
) -> (Vec<[f64; 3]>, Shading) {
    let written: Vec<[f64; 3]> =
        value::elements(mesh.attr(&["n", "normal"]).map_or(&[][..], Attr::numbers)).collect();
    if written.len() == positions.len() {
        return (written, Shading::Vertex);
    }
    if written.len() == corners {
        return (written, Shading::Corner);
    }
    if !written.is_empty() {
        world.refuse(report::NORMALS_DROPPED);
    }
    world.refuse(report::NORMALS_COMPUTED);
    // La normale d'une face est la somme de Newell de son anneau, ramenée à la longueur un : la
    // formule vaut pour une face quelconque, et c'est celle que la coupe par oreilles emploie déjà.
    let mut points: Vec<[f64; 3]> = Vec::new();
    let flat = loops
        .iter()
        .map(|ring| {
            points.clear();
            let read = |vertex: &u32| positions.get(*vertex as usize).copied().unwrap_or_default();
            points.extend(ring.iter().map(read));
            crate::shared_math::normalized_or(ngon::newell(&points), [0.0, 1.0, 0.0])
        })
        .collect::<Vec<[f64; 3]>>();
    (flat, Shading::Face)
}
