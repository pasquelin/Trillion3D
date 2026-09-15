use super::*;

// Lot B5 : classify_link prête un LinkScratch réutilisé au lieu d'allouer trois listes et une pile
// par sommet. Vidé à l'entrée sur chacune de ses dizaines de sorties, y compris les abandons
// anticipés : un bloc réutilisé après une sortie anticipée doit rendre le même verdict qu'un bloc
// neuf.

#[test]
fn classify_link_on_an_empty_link_is_locked() {
    let mut scratch = LinkScratch::default();
    assert_eq!(classify_link(&[], &mut scratch), "locked");
}

#[test]
fn classify_link_skips_a_self_loop_and_stays_locked() {
    let mut scratch = LinkScratch::default();
    assert_eq!(classify_link(&[(4, 4)], &mut scratch), "locked");
}

#[test]
fn classify_link_classifies_a_closed_fan_as_interior() {
    let mut scratch = LinkScratch::default();
    let links = [(1u32, 2u32), (2, 3), (3, 1)];
    assert_eq!(classify_link(&links, &mut scratch), "interior");
}

#[test]
fn classify_link_classifies_an_open_fan_as_boundary() {
    let mut scratch = LinkScratch::default();
    let links = [(1u32, 2u32), (2, 3)];
    assert_eq!(classify_link(&links, &mut scratch), "boundary");
}

#[test]
fn classify_link_reuses_scratch_after_an_early_return_without_leaking_state() {
    let mut scratch = LinkScratch::default();
    // Trois arêtes sur un même sommet : la troisième sort tôt par "locked", laissant le bloc de
    // travail à moitié rempli (ids, neighbours et degree posés, seen et stack jamais touchés).
    let non_manifold = [(1u32, 2u32), (1, 3), (1, 4)];
    assert_eq!(classify_link(&non_manifold, &mut scratch), "locked");
    // Le même bloc, réutilisé sur un éventail fermé propre, doit rendre le même verdict qu'un
    // bloc neuf : la fonction le vide entièrement à l'entrée, quel que soit l'état laissé par
    // l'appel précédent.
    let closed = [(10u32, 20u32), (20, 30), (30, 10)];
    assert_eq!(classify_link(&closed, &mut scratch), "interior");
    // Et un troisième appel, ouvert cette fois, confirme que chaque appel repart bien à zéro.
    let open = [(10u32, 20u32), (20, 30)];
    assert_eq!(classify_link(&open, &mut scratch), "boundary");
}
