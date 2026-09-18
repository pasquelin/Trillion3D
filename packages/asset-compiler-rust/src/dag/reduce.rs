//! La réduction d'un groupe : le simplificateur, puis ce qu'on fait quand il n'avance pas.
//!
//! Deux reprises, chacune mesurée sur une scène réelle avant d'exister :
//! - **La soudure par position.** meshoptimizer ne fait glisser une position copiée — couture d'UV,
//!   arête dure — que le long de sa couture, et verrouille toute position présente en plus de deux
//!   exemplaires. Sur des dalles disjointes qui ne se touchent qu'aux coins il ne réduit rien ; sur
//!   un tronc plein de coutures il consomme les sommets ordinaires puis cale à ÷2 (mesuré : 15 825
//!   → 7 869 → 5 967 → 5 680 → 5 647 triangles, 881 sommets ordinaires pour 1 582 coutures et 259
//!   complexes au sommet du DAG, et rien en dessous de 5 635 même sans aucun verrou). Quand la
//!   réduction ne rend pas moins de grappes qu'elle en a reçu, elle est refaite sur les indices
//!   soudés par (position, uv) : les copies qui ne diffèrent que par leur normale ou leur couleur
//!   deviennent une, les niveaux grossiers pointent sur celle que la soudure retient — sa normale
//!   vaut pour les autres, c'est le coût déclaré —, et le niveau zéro ne change pas. Souder aussi
//!   les coutures de texture a été essayé et mesuré : les façades d'Emerald au seuil de 2 px se
//!   dessinaient avec la texture de l'autre bord de la couture. Refusé.
//! - **Les verrous ajoutés.** Sur du feuillage, une carte dont l'arête est partagée avec un autre
//!   groupe disparaît quand ses sommets libres s'effondrent sur ses sommets verrouillés, et l'autre
//!   groupe garde sa moitié (mesuré : 92 groupes sur 123 perdus ainsi, 339 verrous perdus, tous sur
//!   une arête verrouillée). La reprise verrouille les trois coins de chaque triangle qui touchait
//!   un verrou perdu et relance : quelques cartes restent, le reste du groupe se réduit.
use super::*;
use crate::qem::SimplifiedMesh;
use border::{live_triangles, lock_triangles_touching, lost_locks, required_locks};

/// Combien de fois un groupe est relancé avec des verrous en plus avant d'être déclaré perdu.
const BORDER_RETRIES: usize = 3;

/// Une réduction qui a abouti : la surface simplifiée et sa redécoupe en grappes.
struct Attempt {
    simplified: SimplifiedMesh,
    clusters: Vec<Vec<u32>>,
    /// Des verrous ont été ajoutés pour garder le bord.
    relocked: bool,
}
impl Attempt {
    /// Une réduction qui ne rend pas moins de grappes qu'elle en a reçu ne fait pas monter le DAG.
    fn progresses(&self, children: usize) -> bool {
        self.clusters.len() < children
    }
}

pub(super) fn reduce_group(
    input: &GroupReductionInput,
    children: &[&DagCluster],
) -> Result<std::result::Result<GroupReduction, GroupOutcome>> {
    let mut merged = Vec::with_capacity(children.iter().map(|c| c.indices.len()).sum());
    let mut spheres = Vec::with_capacity(children.len());
    let mut child_error = 0.0_f64;
    let mut source_rank = u32::MAX;
    for child in children {
        merged.extend_from_slice(&child.indices);
        spheres.push(child.sphere);
        child_error = child_error.max(child.lod_error);
        source_rank = source_rank.min(child.source_rank);
    }
    let sphere = enclosing_sphere(&spheres);
    let live = live_triangles(merged.iter().copied());
    let raw = attempt(input, &live)?;
    let (chosen, welded) = match raw {
        Ok(raw) if raw.progresses(children.len()) => (raw, false),
        raw => {
            let welded_indices =
                live_triangles(merged.iter().map(|&i| input.weld_seam[i as usize]));
            // Un maillage déjà indexé, sans copie à souder, ne se relance pas pour la même réponse.
            let welded = if welded_indices == live {
                Err(GroupOutcome::NoCollapse)
            } else {
                attempt(input, &welded_indices)?
            };
            match (raw, welded) {
                (Ok(raw), Ok(welded)) if !welded.progresses(children.len()) => (raw, false),
                (_, Ok(welded)) => (welded, true),
                (Ok(raw), Err(_)) => (raw, false),
                (Err(outcome), Err(_)) => return Ok(Err(outcome)),
            }
        }
    };
    let error = chosen.simplified.error_object.max(child_error);
    if !error.is_finite() {
        return Ok(Err(GroupOutcome::UnusableError));
    }
    Ok(Ok(GroupReduction {
        error,
        sphere,
        clusters: chosen.clusters,
        source_rank,
        welded,
        relocked: chosen.relocked,
    }))
}

/// Simplifie `source` à la moitié de ses triangles, en relançant avec des verrous en plus tant
/// qu'un sommet partagé disparaît, puis redécoupe le résultat en grappes.
fn attempt(
    input: &GroupReductionInput,
    source: &[u32],
) -> Result<std::result::Result<Attempt, GroupOutcome>> {
    let (locks, weld) = (input.locks, input.weld);
    let triangles = source.len() / 3;
    if triangles < 2 {
        return Ok(Err(GroupOutcome::TooSmall));
    }
    let required = required_locks(source, locks, weld);
    let mut extra: Vec<u32> = Vec::new();
    let mut retries = 0usize;
    loop {
        let simplified = {
            let _t = Timer::new(Phase::Simplify);
            simplify_with_locked_vertices(
                input.positions,
                source,
                triangles / 2,
                SIMPLIFY_ERROR_CEILING,
                &|vertex| {
                    locks.get(vertex as usize).copied().unwrap_or(true)
                        || extra.binary_search(&weld[vertex as usize]).is_ok()
                },
            )?
        };
        if simplified.triangles >= triangles || simplified.indices.is_empty() {
            return Ok(Err(GroupOutcome::NoCollapse));
        }
        let lost = lost_locks(&required, &simplified.indices, weld);
        if lost.is_empty() {
            let clusters = {
                let _t = Timer::new(Phase::Resplit);
                cluster_triangles(input.positions, &simplified.indices, DAG_CLUSTER_TRIANGLES)?
            };
            return Ok(Ok(Attempt {
                simplified,
                clusters,
                relocked: retries > 0,
            }));
        }
        if retries == BORDER_RETRIES {
            return Ok(Err(GroupOutcome::BorderLost));
        }
        retries += 1;
        lock_triangles_touching(source, &lost, weld, &mut extra);
    }
}
