use super::*;
use crate::dag::border::{live_triangles, lock_triangles_touching, lost_locks, required_locks};

/// La grille de `grid`, éclatée en soupe : trois sommets par triangle, aucun partagé. C'est la forme
/// d'un FBX dont les attributs sont écrits coin par coin, et celle sur laquelle meshoptimizer ne
/// réduit rien tant que les positions ne sont pas soudées.
fn soup(n: usize) -> (Vec<f32>, Vec<u32>) {
    let (positions, indices) = grid(n);
    let mut soup_positions = Vec::with_capacity(indices.len() * 3);
    for &id in &indices {
        soup_positions.extend_from_slice(&positions[id as usize * 3..id as usize * 3 + 3]);
    }
    (soup_positions, (0..indices.len() as u32).collect())
}

// Comportement : une soupe de sommets monte jusqu'à une racine unique — la soudure par position
// prend le relais quand la réduction brute ne rend pas moins de grappes —, et ses niveaux
// grossiers ne citent que des sommets que la soudure retient.
#[test]
fn a_vertex_soup_still_climbs_to_a_single_root() {
    let (positions, indices) = soup(64);
    let (dag, _, tallies) = build_of(&positions, &indices);
    let depth = dag.iter().map(|c| c.level).max().unwrap_or(0);
    assert!(depth > 0, "la soupe doit avoir des niveaux grossiers");
    assert_eq!(
        dag.iter().filter(|c| c.is_root()).count(),
        1,
        "une seule racine"
    );
    assert!(
        tallies.iter().any(|t| t.welded > 0),
        "au moins un groupe a dû souder"
    );
    let weld = weld_positions(&positions, &indices);
    for cluster in dag.iter().filter(|c| c.level > 0) {
        for &id in &cluster.indices {
            assert_eq!(
                weld[id as usize], id,
                "un niveau grossier cite la copie canonique"
            );
        }
    }
}

#[test]
fn lost_locks_lists_the_locked_vertices_that_vanished_by_welded_id() {
    // 0 et 3 sont soudés ; 0 verrouillé et absent, mais son double 3 survit — rien n'est perdu.
    let weld = [0u32, 1, 2, 0, 4];
    let locks = [true, false, true, false, true];
    let required = required_locks(&[0, 1, 2], &locks, &weld);
    assert_eq!(required, vec![0, 2]);
    assert_eq!(lost_locks(&required, &[3, 1], &weld), vec![2]);
    assert_eq!(
        lost_locks(&required_locks(&[0, 1, 4], &locks, &weld), &[1], &weld),
        vec![0, 4]
    );
}

#[test]
fn lock_triangles_touching_locks_every_corner_of_a_triangle_that_lost_a_lock() {
    // Deux triangles ; seul le premier touche le sommet perdu 5 (par son double soudé 7).
    let weld = [0u32, 1, 2, 3, 4, 5, 6, 5];
    let source = [0u32, 1, 7, 2, 3, 4];
    let mut extra = vec![9];
    lock_triangles_touching(&source, &[5], &weld, &mut extra);
    assert_eq!(
        extra,
        vec![0, 1, 5, 9],
        "les trois coins, soudés, plus ce qui l'était déjà"
    );
}

#[test]
fn live_triangles_drops_a_triangle_with_two_corners_on_one_position() {
    let kept = live_triangles([0u32, 1, 2, 3, 3, 4, 5, 6, 5, 7, 8, 9].into_iter());
    assert_eq!(kept, vec![0, 1, 2, 7, 8, 9]);
}
