//! A10 : une arête que plus de deux faces se partagent n'a pas d'éventail à lire. L'aide le promet
//! depuis toujours, mais elle réunissait dès la deuxième rencontre, avant de savoir qu'une
//! troisième face existait : les deux premières faces du fichier se lissaient ensemble, la
//! troisième restait seule, et changer l'ordre des faces changeait la sortie.
use super::*;

/// Cinq sommets : l'arête partagée, puis un sommet libre par face.
const POINTS: [f32; 15] = [0., 0., 0., 1., 0., 0., 0., 1., 0., 0., -1., 0., 0., 0., 1.];
/// Trois triangles qui se partagent tous l'arête `0–1`, chacun dans son propre plan.
const FAN: [[u32; 3]; 3] = [[0, 1, 2], [1, 0, 3], [0, 1, 4]];

/// La normale de chaque face de `FAN`, celle que ses trois coins portent quand rien ne les lisse.
const PLANES: [[f32; 3]; 3] = [[0., 0., 1.], [0., 0., 1.], [0., -1., 0.]];

/// Les normales et les groupes des coins, les faces posées dans cet ordre, avec ces marques.
fn shade(order: &[usize], sharp_faces: &[bool], sharp_corners: &[bool]) -> Shaded {
    let mut corners_of: Vec<u32> = Vec::new();
    let mut offsets: Vec<u32> = vec![0];
    for face in order {
        corners_of.extend(FAN[*face]);
        offsets.push(corners_of.len() as u32);
    }
    corners(&Surface {
        positions: &POINTS,
        corners: &corners_of,
        offsets: &offsets,
        sharp_faces,
        sharp_corners,
    })
}

/// Les groupes de lissage des coins, les faces posées dans cet ordre et toutes lisses.
fn groups(order: &[usize]) -> Vec<u32> {
    shade(order, &[], &[]).groups
}

/// Aucun coin réuni, et chacun sur la normale de sa seule face : l'éventail illisible rendu tel quel.
fn assert_aucun_lissage(shaded: &Shaded, order: &[usize], case: &str) {
    assert_eq!(
        shaded.groups,
        (0..9).collect::<Vec<u32>>(),
        "groupes, {case}"
    );
    for (rank, face) in order.iter().enumerate() {
        for corner in 0..3 {
            let at = (rank * 3 + corner) * 3;
            assert_eq!(
                &shaded.normals[at..at + 3],
                &PLANES[*face][..],
                "normale du coin {corner} de la face {face}, {case}"
            );
        }
    }
}

// Constat A10 : trois faces sur une arête, et aucun coin n'est réuni — quel que soit l'ordre dans
// lequel le fichier les écrit. Deviner un éventail là où il n'y en a pas rendrait un coin au hasard.
#[test]
fn une_arete_a_trois_faces_ne_reunit_aucun_coin_quel_que_soit_lordre() {
    let alone: Vec<u32> = (0..9).collect();
    for order in [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ] {
        assert_eq!(groups(&order), alone, "ordre {order:?}");
    }
}

// L'autre bout, que la correction ne doit pas emporter : une arête que deux faces se partagent
// réunit bien leurs coins de même sommet, et c'est la règle de lissage ordinaire.
#[test]
fn une_arete_a_deux_faces_reunit_toujours_ses_coins() {
    assert_eq!(groups(&[0, 1]), vec![0, 1, 2, 1, 0, 5]);
    // Une arête de bord, que personne ne partage, ne réunit rien non plus.
    assert_eq!(groups(&[0]), vec![0, 1, 2]);
}

// Constat V01, première variante : une seule des trois faces porte la marque « face nette ». La
// topologie compte toujours trois faces sur l'arête, et une marque de lissage n'en retire aucune :
// elle ne décide que des unions. Avant correction, le comptage sautait la face nette, n'en voyait
// plus que deux et soudait les deux autres — groupes `[0,1,2,1,0,5,6,7,8]`, normales moyennées.
#[test]
fn v01_une_face_nette_ne_soude_pas_les_deux_autres_faces_de_larete() {
    let order = [0, 1, 2];
    for nette in 0..3 {
        let mut sharp_faces = [false; 3];
        sharp_faces[nette] = true;
        let shaded = shade(&order, &sharp_faces, &[]);
        assert_aucun_lissage(&shaded, &order, &format!("face nette {nette}"));
    }
}

// Deuxième variante du même constat : l'arête partagée est dure sur une seule des trois faces. Le
// coin qui la porte est le premier de chaque face de `FAN`. Même contrat, même défaut avant
// correction : deux incidences restantes, deux faces soudées.
#[test]
fn v01_une_arete_dure_ne_soude_pas_les_deux_autres_faces_de_larete() {
    let order = [0, 1, 2];
    for dure in 0..3 {
        let mut sharp_corners = [false; 9];
        sharp_corners[dure * 3] = true;
        let shaded = shade(&order, &[], &sharp_corners);
        assert_aucun_lissage(&shaded, &order, &format!("arête dure sur la face {dure}"));
    }
}
