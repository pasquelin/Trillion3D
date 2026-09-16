//! Un nœud `mesh` vers un maillage glTF : les tableaux écrits, les faces résolues par les arêtes,
//! et une primitive par matériau lié.
//!
//! Les polygones sont triangulés par oreilles dans le plan de leur normale, ce qui conserve l'aire
//! et la silhouette d'une face concave comme d'une face convexe. Une face qui déclare un trou est
//! laissée : le découpage le remplirait, et une silhouette ne se devine pas. D'où viennent les
//! normales, `.n` ou les arêtes, c'est `shade` qui le dit.
use super::*;

mod corner;
mod part;
mod shade;

/// Les tableaux d'une surface, lus une fois pour toutes ses parties.
pub(super) struct Surface {
    positions: Vec<[f64; 3]>,
    /// Les boucles de sommets de chaque face, déjà résolues depuis les arêtes.
    loops: Vec<Vec<u32>>,
    /// Les rangs d'UV de chaque coin, dans l'ordre des boucles ; vide quand la face n'en porte pas.
    uv_slots: Vec<Vec<i64>>,
    uvs: Vec<[f64; 2]>,
    normals: Vec<[f64; 3]>,
    /// Le groupe de lissage de chaque coin, quand ce pilote a calculé les normales : deux coins d'un
    /// même groupe portent la même normale, donc ne font qu'un sommet. Vide quand `.n` les donne.
    groups: Vec<u32>,
    /// Le rang du premier coin de chaque face dans le maillage entier, tel que `.fc` l'a écrit.
    bases: Vec<usize>,
    /// Où lire la normale d'un coin : par sommet, ou par coin du maillage.
    shading: Shading,
}

/// La provenance des normales de cette surface.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Shading {
    Vertex,
    Corner,
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
    let mut surface = Surface {
        positions,
        loops,
        uv_slots,
        uvs,
        normals: Vec::new(),
        groups: Vec::new(),
        bases,
        shading: Shading::Corner,
    };
    shade::fill(world, &mut surface, mesh, polygons, &edges);
    Some(surface)
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

/// Le rang d'une arête signée de Maya et l'extrémité qu'elle désigne : `-(i + 1)` parcourt l'arête
/// `i` à l'envers, et son coin est alors le second sommet de l'arête. La valeur la plus basse d'un
/// entier signé n'a pas d'opposé : elle ne désigne aucune arête, au lieu de faire déborder la
/// négation, et l'appelant compte la face sous `ma-mesh-invalid`.
pub(super) fn edge_rank(signed: i64) -> Option<(usize, usize)> {
    match signed < 0 {
        true => Some((
            usize::try_from(signed.checked_neg()?.checked_sub(1)?).ok()?,
            1,
        )),
        false => Some((usize::try_from(signed).ok()?, 0)),
    }
}

/// Le sommet de départ d'une arête signée. Maya écrit `-(i + 1)` pour une arête parcourue à
/// l'envers : le coin est alors le second sommet de l'arête `i`. La valeur la plus basse d'un
/// entier signé n'a pas d'opposé : elle ne donne donc aucun rang, et l'appelant la compte sous
/// `ma-mesh-invalid`, au lieu de faire déborder la négation.
pub(super) fn corner(edges: &[[f64; 3]], signed: i64, vertices: usize) -> Option<u32> {
    let (rank, end) = edge_rank(signed)?;
    let vertex = usize::try_from(*edges.get(rank)?.get(end)? as i64).ok()?;
    (vertex < vertices)
        .then(|| u32::try_from(vertex).ok())
        .flatten()
}
