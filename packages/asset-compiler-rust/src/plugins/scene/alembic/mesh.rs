//! De la géométrie lue aux morceaux d'un maillage glTF : une part par face set, plus une part pour
//! les faces qu'aucun face set ne revendique.
//!
//! Deux conversions ont lieu ici, et elles sont exactes. **L'enroulement** : Alembic décrit ses
//! faces dans l'ordre horaire vu de l'extérieur, le glTF dans l'ordre inverse ; lire chaque face à
//! l'envers suffit, et rien d'autre ne change — aucun sommet n'est déplacé. **Le découpage des
//! coins** : un fichier Alembic donne une position par sommet mais peut donner une normale et une
//! coordonnée de texture par coin de face, là où le glTF n'a qu'un seul tableau par sommet ; chaque
//! triplet distinct (sommet, normale, coordonnée) devient donc un sommet du glTF, et les triplets
//! identiques restent un seul sommet. Les faces de plus de trois côtés sont coupées en oreilles
//! dans le plan de leur normale, ce qui conserve l'aire et la silhouette d'une face plane, qu'elle
//! soit convexe ou creusée.
use self::build::Builder;
use super::geom::Geometry;
use super::TOPOLOGY_INVALID;
use crate::{CompilerError, Result};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

mod build;

/// Coins au plus dans un maillage. Au-delà, ce n'est plus une scène mais une table corrompue.
const MAX_CORNERS: usize = 64 << 20;

/// Un face set : un nom de matériau et les faces qu'il porte.
pub(super) struct FaceSet {
    pub(super) name: String,
    pub(super) faces: Vec<i32>,
}

/// Un morceau de maillage prêt à devenir une primitive glTF.
pub(super) struct Part {
    /// Le rang du face set dont ce morceau vient, ou `None` pour les faces sans face set.
    pub(super) faceset: Option<usize>,
    pub(super) positions: Vec<f32>,
    pub(super) normals: Vec<f32>,
    pub(super) uvs: Vec<f32>,
    pub(super) indices: Vec<u32>,
    pub(super) min: [f32; 3],
    pub(super) max: [f32; 3],
}

/// Ce que le découpage a rencontré et que le rapport doit dire.
#[derive(Default)]
pub(super) struct Counted {
    /// Des faces revendiquées par deux face sets : seule la première revendication compte.
    pub(super) overlaps: usize,
    /// Des faces de moins de trois côtés, qui ne portent aucune surface.
    pub(super) degenerate: usize,
    /// Des faces que la coupe par oreilles n'a pas su découper entièrement.
    pub(super) uncut: usize,
}

/// Le face set de chaque face, et ce que la répartition a rencontré. Une face revendiquée deux fois
/// reste au premier face set : un triangle n'appartient qu'à un matériau.
fn assign(facesets: &[FaceSet], faces: usize) -> (Vec<Option<usize>>, usize) {
    let mut out = vec![None; faces];
    let mut overlaps = 0;
    for (rank, faceset) in facesets.iter().enumerate() {
        for face in &faceset.faces {
            let Ok(face) = usize::try_from(*face) else {
                continue;
            };
            match out.get(face) {
                Some(None) => out[face] = Some(rank),
                Some(Some(_)) => overlaps += 1,
                None => {}
            }
        }
    }
    (out, overlaps)
}

/// Découpe la géométrie en morceaux, un par face set utilisé, dans l'ordre des face sets. Le jeton
/// d'annulation est relu par tranche de faces : un seul maillage énorme s'arrête aussi.
pub(super) fn parts(
    geometry: &Geometry,
    facesets: &[FaceSet],
    cancelled: &AtomicBool,
) -> Result<(Vec<Part>, Counted)> {
    if geometry.corners.len() > MAX_CORNERS {
        return Err(CompilerError::new(
            TOPOLOGY_INVALID,
            format!(
                "alembic: a mesh declares {} face corners, above the {MAX_CORNERS} ceiling",
                geometry.corners.len()
            ),
        ));
    }
    let (owner, overlaps) = assign(facesets, geometry.counts.len());
    let mut counted = Counted {
        overlaps,
        ..Counted::default()
    };
    let mut builders: HashMap<Option<usize>, Builder> = HashMap::new();
    let mut at = 0usize;
    for (face, count) in geometry.counts.iter().enumerate() {
        let sides = usize::try_from(*count).unwrap_or(0);
        let corners = at..at.saturating_add(sides);
        at = corners.end;
        if sides < 3 {
            counted.degenerate += 1;
            continue;
        }
        if corners.end > geometry.corners.len() {
            return Err(CompilerError::new(
                TOPOLOGY_INVALID,
                "alembic: a mesh declares more face corners than it carries face indices",
            ));
        }
        let owner = owner.get(face).copied().flatten();
        let builder = builders.entry(owner).or_default();
        if !builder.face(geometry, face, corners, cancelled)? {
            counted.uncut += 1;
        }
    }
    let mut out: Vec<Part> = builders
        .into_iter()
        .map(|(faceset, builder)| builder.finish(faceset))
        .filter(|part| !part.indices.is_empty())
        .collect();
    out.sort_by_key(|part| (part.faceset.is_none(), part.faceset.unwrap_or(0)));
    Ok((out, counted))
}
