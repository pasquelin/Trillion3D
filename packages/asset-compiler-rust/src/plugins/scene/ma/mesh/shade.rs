//! D'où vient la normale de chaque coin d'une surface Maya.
//!
//! Un `.ma` écrit ses normales de trois façons, et une seule à la fois. `.n` en donne une par
//! sommet, ou une par coin de face : ce sont celles de Maya, et elles sont reprises telles quelles.
//! Sans elles, c'est la géométrie qui les donne — et c'est le **drapeau de dureté** de chaque arête,
//! le troisième nombre de `.ed`, qui dit où la continuité se coupe. Le calculer à plat comme si
//! toutes les arêtes étaient dures rendait une sphère à facettes ; le lisser partout aurait arrondi
//! toutes les arêtes vives. Le fichier le dit, arête par arête.
use super::*;
use crate::plugins::scene::normals;

/// Remplit les normales de la surface et dit où chaque coin lit la sienne.
pub(super) fn fill(
    world: &mut World<'_>,
    surface: &mut Surface,
    mesh: &Node,
    polygons: &[faces::Face],
    edges: &[[f64; 3]],
) {
    let corners: usize = polygons.iter().map(|face| face.edges.len()).sum();
    let written: Vec<[f64; 3]> =
        value::elements(mesh.attr(&["n", "normal"]).map_or(&[][..], Attr::numbers)).collect();
    for (count, shading) in [
        (surface.positions.len(), Shading::Vertex),
        (corners, Shading::Corner),
    ] {
        if written.len() == count {
            surface.normals = written;
            surface.shading = shading;
            return;
        }
    }
    if !written.is_empty() {
        world.refuse(report::NORMALS_DROPPED);
    }
    world.refuse(report::NORMALS_COMPUTED);
    compute(surface, polygons, edges, corners);
}

/// Calcule les normales depuis la géométrie et range chaque coin à la place que `.fc` lui donne —
/// la même que des normales écrites par coin, pour que la lecture ne connaisse qu'une disposition.
fn compute(surface: &mut Surface, polygons: &[faces::Face], edges: &[[f64; 3]], corners: usize) {
    let positions: Vec<f32> = surface
        .positions
        .iter()
        .flat_map(|point| point.map(|axis| axis as f32))
        .collect();
    let (mut ring, mut offsets, mut hard) = (Vec::new(), vec![0u32], Vec::new());
    for (face, loops) in surface.loops.iter().enumerate() {
        ring.extend_from_slice(loops);
        offsets.push(ring.len() as u32);
        let written = polygons.get(face).map_or(&[][..], |face| &face.edges);
        hard.extend((0..loops.len()).map(|rank| is_hard(edges, written.get(rank).copied())));
    }
    let shaded = normals::corners(&normals::Surface {
        positions: &positions,
        corners: &ring,
        offsets: &offsets,
        sharp_faces: &[],
        sharp_corners: &hard,
    });
    surface.normals = vec![[0.0, 1.0, 0.0]; corners];
    surface.groups = vec![0; corners];
    let mut at = 0usize;
    for (face, loops) in surface.loops.iter().enumerate() {
        for rank in 0..loops.len() {
            let Some(into) = surface.bases.get(face).map(|base| base + rank) else {
                continue;
            };
            let read = |axis: usize| shaded.normals[(at + rank) * 3 + axis] as f64;
            surface.normals[into] = [read(0), read(1), read(2)];
            surface.groups[into] = shaded.groups[at + rank];
        }
        at += loops.len();
    }
    surface.shading = Shading::Corner;
}

/// L'arête que ce coin porte est-elle dure ? Maya écrit trois nombres par arête — ses deux sommets,
/// puis le drapeau —, et une face cite ses arêtes signées : `-(i + 1)` la parcourt à l'envers, ce
/// qui ne change rien à sa dureté. La valeur la plus basse d'un entier signé n'a pas d'opposé, donc
/// ne désigne aucune arête ; la face entière est déjà comptée ailleurs sous `ma-mesh-invalid`.
fn is_hard(edges: &[[f64; 3]], signed: Option<i64>) -> bool {
    signed
        .and_then(super::edge_rank)
        .and_then(|(rank, _)| edges.get(rank))
        .is_some_and(|edge| edge[2] != 0.0)
}
