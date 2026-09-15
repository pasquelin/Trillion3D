use super::*;

// Lot B3 : refine_bisection remplace un HashSet<usize> reconstruit à chaque coupe par une table
// `present` de booléens réutilisée, entièrement remise à `false` en sortie ; border_survived
// remplace deux HashSet<u32> par deux listes triées et une fusion. Même verdict dans les deux cas.

#[test]
fn refine_bisection_on_a_single_member_slice_leaves_it_in_place_and_clears_present() {
    let slice = [0usize];
    let mut side = [0u8];
    let adjacency: Vec<Vec<(u32, u32)>> = vec![Vec::new()];
    let mut present = vec![false];
    // Plancher nul : un seul côté peuplé ne peut jamais dépasser le plancher de l'autre.
    refine_bisection(&slice, &mut side, &adjacency, 0, &mut present);
    assert_eq!(side, [0u8]);
    assert!(present.iter().all(|&p| !p), "present doit repartir à false");
}

#[test]
fn refine_bisection_moves_a_member_whose_neighbours_are_mostly_on_the_other_side() {
    // 0 et 1 côté 0, 2 et 3 côté 1. Le membre 1 pèse plus lourd vers 2 et 3 (poids 5 chacun) que
    // vers 0 (poids 1) : il doit rejoindre le côté 1. Le plancher à 1 empêche le côté 0 de se
    // vider complètement une fois 1 parti, donc 0 reste en place.
    let slice = [0usize, 1, 2, 3];
    let mut side = [0u8, 0, 1, 1];
    let adjacency: Vec<Vec<(u32, u32)>> = vec![
        vec![(1, 1)],
        vec![(0, 1), (2, 5), (3, 5)],
        vec![(1, 5), (3, 1)],
        vec![(1, 5), (2, 1)],
    ];
    let mut present = vec![false; 4];
    refine_bisection(&slice, &mut side, &adjacency, 1, &mut present);
    assert_eq!(
        side,
        [0u8, 1, 1, 1],
        "1 rejoint le côté 1, 0 reste protégé par le plancher"
    );
    assert!(present.iter().all(|&p| !p), "present doit repartir à false");
}

#[test]
fn refine_bisection_ignores_a_neighbour_outside_the_slice() {
    // Le voisin 9 n'appartient pas à la tranche : present ne le marque jamais, donc il ne doit
    // compter ni comme interne ni comme externe.
    let slice = [0usize, 1];
    let mut side = [0u8, 1];
    let adjacency: Vec<Vec<(u32, u32)>> = vec![vec![(9, 5)], vec![]];
    let mut present = vec![false; 10];
    refine_bisection(&slice, &mut side, &adjacency, 0, &mut present);
    assert_eq!(
        side,
        [0u8, 1],
        "un voisin hors tranche ne doit rien déplacer"
    );
    assert!(present.iter().all(|&p| !p));
}

#[test]
fn border_survived_is_true_when_nothing_is_locked() {
    let merged = [0u32, 1, 2];
    let simplified: [u32; 0] = [];
    let locks = [false, false, false];
    let weld = [0u32, 1, 2];
    assert!(border_survived(&merged, &simplified, &locks, &weld));
}

#[test]
fn border_survived_detects_a_locked_vertex_lost_by_simplification() {
    let merged = [0u32, 1, 2];
    let simplified = [1u32];
    let locks = [true, false, false];
    let weld = [0u32, 1, 2];
    assert!(
        !border_survived(&merged, &simplified, &locks, &weld),
        "le sommet verrouillé 0 a disparu de la liste simplifiée"
    );
}

#[test]
fn border_survived_follows_welding_not_raw_indices() {
    // 0 et 3 sont soudés au même sommet (weld[0] == weld[3] == 0) : 0 est verrouillé mais absent
    // de simplified, or son double soudé 3 y est toujours — la soudure doit suffire.
    let merged = [0u32, 1];
    let simplified = [3u32, 1];
    let locks = [true, false, false, false];
    let weld = [0u32, 1, 2, 0];
    assert!(border_survived(&merged, &simplified, &locks, &weld));
}

#[test]
fn border_survived_handles_a_group_of_thirty_two_clusters_worth_of_corners() {
    // Un groupe de DAG_GROUP_MAX (32) clusters de 128 triangles : 32 * 128 * 3 coins, verrous et
    // soudure denses, comme le banc B3 le mesure.
    const CORNERS: usize = DAG_GROUP_MAX * 128 * 3;
    let merged: Vec<u32> = (0..CORNERS as u32).collect();
    let simplified: Vec<u32> = merged.iter().rev().copied().collect();
    let locks: Vec<bool> = (0..CORNERS).map(|i| i % 4 == 0).collect();
    let weld: Vec<u32> = (0..CORNERS as u32).collect();
    assert!(
        border_survived(&merged, &simplified, &locks, &weld),
        "toute permutation de la même liste garde chaque sommet verrouillé"
    );
}
