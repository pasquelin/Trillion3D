//! Les normales d'un maillage Blender : faces nettes, faces lisses, et les arêtes que le fichier
//! marque dures. Un toit de deux versants suffit à les séparer toutes les trois.
use super::*;

/// Un toit de deux quadrilatères qui partagent l'arête de faîte, `v2`–`v3`. Les deux versants ont la
/// même aire : leur moyenne au faîte est donc exactement verticale, ce qui se lit à l'œil nu.
fn roof(sharp_faces: Vec<bool>, sharp_corners: Vec<bool>) -> Geometry {
    Geometry {
        positions: vec![
            0.0, 0.0, 0.0, // v0, égout gauche
            0.0, 1.0, 0.0, // v1
            1.0, 0.0, 1.0, // v2, faîte
            1.0, 1.0, 1.0, // v3
            2.0, 0.0, 0.0, // v4, égout droit
            2.0, 1.0, 0.0, // v5
        ],
        corners: vec![0, 2, 3, 1, 2, 4, 5, 3],
        offsets: vec![0, 4, 8],
        uv: Vec::new(),
        material: vec![0, 0],
        sharp: sharp_faces,
        sharp_corners,
    }
}

/// La normale d'un coin, telle que le calcul commun la rend.
fn corner(shaded: &[f32], rank: usize) -> [f32; 3] {
    [shaded[rank * 3], shaded[rank * 3 + 1], shaded[rank * 3 + 2]]
}

/// Deux normales se ressemblent-elles au millionième près ?
fn close(left: [f32; 3], right: [f32; 3]) -> bool {
    (0..3).all(|axis| (left[axis] - right[axis]).abs() < 1e-6)
}

/// La pente d'un versant, de longueur un : c'est la normale à plat de chaque face du toit.
const LEFT: [f32; 3] = [
    -std::f32::consts::FRAC_1_SQRT_2,
    0.0,
    std::f32::consts::FRAC_1_SQRT_2,
];
const RIGHT: [f32; 3] = [
    std::f32::consts::FRAC_1_SQRT_2,
    0.0,
    std::f32::consts::FRAC_1_SQRT_2,
];

// Comportement : une face nette garde sa propre normale sur chacun de ses coins ; deux faces lisses
// qui partagent une arête douce moyennent la leur sur les coins de cette arête.
#[test]
fn sharp_faces_keep_their_own_normal_and_smooth_faces_share_it() {
    let flat = normals::corners(&roof(vec![true, true], Vec::new()).surface()).normals;
    assert_eq!(flat.len(), 24);
    for rank in 0..4 {
        assert!(close(corner(&flat, rank), LEFT), "{flat:?}");
        assert!(close(corner(&flat, rank + 4), RIGHT), "{flat:?}");
    }
    let smooth = normals::corners(&roof(vec![false, false], Vec::new()).surface()).normals;
    // Les quatre coins du faîte — `v2` et `v3` dans chacune des deux faces — moyennent les deux
    // versants : leur normale est verticale.
    for rank in [1, 2, 4, 7] {
        assert!(close(corner(&smooth, rank), [0.0, 0.0, 1.0]), "{smooth:?}");
    }
    // Les égouts ne touchent qu'un versant : ils gardent sa pente.
    for rank in [0, 3] {
        assert!(close(corner(&smooth, rank), LEFT), "{smooth:?}");
    }
    for rank in [5, 6] {
        assert!(close(corner(&smooth, rank), RIGHT), "{smooth:?}");
    }
}

// Constat 22 : une arête marquée dure sépare les deux faces qu'elle borde, même lisses. Le faîte du
// toit rendait une normale verticale des deux côtés — une arête vive arrondie —, alors que le
// fichier la déclare dure : chaque versant garde désormais sa propre pente sur ses quatre coins.
#[test]
fn a_hard_edge_splits_the_normals_of_the_two_smooth_faces_it_borders() {
    // L'arête de faîte part du coin 1 dans la première face et du coin 7 dans la seconde.
    let mut hard = vec![false; 8];
    hard[1] = true;
    hard[7] = true;
    let shaded = normals::corners(&roof(vec![false, false], hard).surface());
    for rank in 0..4 {
        assert!(
            close(corner(&shaded.normals, rank), LEFT),
            "le versant gauche garde sa pente : {:?}",
            shaded.normals
        );
        assert!(
            close(corner(&shaded.normals, rank + 4), RIGHT),
            "le versant droit garde la sienne : {:?}",
            shaded.normals
        );
    }
    assert_ne!(
        shaded.groups[1], shaded.groups[7],
        "les deux coins du faîte ne sont plus du même éventail"
    );
}

// Constat 22, côté fichier : c'est bien l'attribut `sharp_edge` de la fixture qui décide. La même
// fixture, une fois toutes arêtes douces et une fois toutes arêtes dures, rendait exactement le même
// maillage : la marque du fichier n'était jamais lue.
#[test]
fn the_sharp_edge_attribute_of_the_file_changes_the_normals_it_computes() {
    let vertices = |bytes: &[u8], tag: &str| {
        let gltf = sortie::compiled(bytes, tag).0;
        let accessors = gltf["accessors"].clone();
        gltf["meshes"]
            .as_array()
            .expect("meshes")
            .iter()
            .flat_map(|mesh| mesh["primitives"].as_array().expect("primitives"))
            .filter_map(|part| part["attributes"]["NORMAL"].as_u64())
            .map(|rank| accessors[rank as usize]["count"].as_u64().expect("compte"))
            .sum::<u64>()
    };
    let soft = vertices(&surgery::with_sharp_edges(false), "aretes-douces");
    let hard = vertices(&surgery::with_sharp_edges(true), "aretes-dures");
    assert!(
        hard > soft,
        "des arêtes toutes dures coupent les normales, donc écrivent plus de sommets : {soft} contre {hard}"
    );
}
