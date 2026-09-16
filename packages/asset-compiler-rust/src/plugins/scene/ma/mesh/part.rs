//! Le découpage d'une surface en parties de matériau, et la primitive glTF que chacune donne.
//!
//! Un `shadingEngine` réclame soit le maillage entier, soit les faces que sa liste de composants
//! nomme. Une liaison entière ne prend donc que ce qu'aucune liaison par faces n'a pris : c'est
//! ainsi qu'un maillage à plusieurs matériaux rend plusieurs primitives, sans qu'aucune face ne
//! soit dessinée deux fois.
//!
//! Une primitive glTF porte ses attributs pour tous ses sommets ou pour aucun. Une part dont une
//! face seulement porte des coordonnées de texture n'en porte donc aucune, et l'écart est compté :
//! donner `(0, 0)` aux autres inventerait un placage que le fichier n'écrit pas. Ce que devient un
//! coin de face, lui, se lit dans `corner`.
use super::*;
use crate::import::{primitive, Vertices};
use crate::plugins::scene::{cancel, ngon::Ngon};

/// Une part de matériau : son matériau glTF, et les faces qu'elle porte.
struct Part {
    material: Option<usize>,
    faces: Vec<usize>,
}

/// Écrit les primitives de la surface et pose le maillage dans la table.
pub(super) fn emit(world: &mut World<'_>, node: usize, surface: &Surface) -> Option<usize> {
    let mut primitives = Vec::new();
    let mut triangles = 0usize;
    for part in parts(world, node, surface.loops.len()) {
        let Some((value, count)) = build(world, surface, &part) else {
            continue;
        };
        triangles += count;
        primitives.push(value);
    }
    if primitives.is_empty() {
        world.refuse(report::MESH_EMPTY);
        return None;
    }
    let name = world.document.nodes[node].name.clone();
    world
        .scene
        .meshes
        .push(json!({"name":name,"primitives":primitives}));
    world.scene.mesh_triangles.push(triangles);
    Some(world.scene.meshes.len() - 1)
}

/// Les parts de ce maillage. Sans aucune liaison, une seule part sans matériau porte toutes les
/// faces : un maillage qu'aucun ensemble ne nuance reste visible.
fn parts(world: &mut World<'_>, node: usize, faces: usize) -> Vec<Part> {
    let binds: Vec<(Option<usize>, Option<Vec<usize>>)> = world
        .graph
        .binds
        .get(&node)
        .map(|binds| {
            binds
                .iter()
                .map(|bind| (bind.shader, bind.faces.clone()))
                .collect()
        })
        .unwrap_or_default();
    if binds.is_empty() {
        return vec![Part {
            material: None,
            faces: (0..faces).collect(),
        }];
    }
    let mut taken = vec![false; faces];
    let mut out = Vec::with_capacity(binds.len());
    for (shader, named) in binds.iter().filter(|(_, named)| named.is_some()) {
        let owned = named
            .iter()
            .flatten()
            .filter(|face| **face < faces && !std::mem::replace(&mut taken[**face], true))
            .copied()
            .collect();
        let material = shader.and_then(|shader| material::resolve(world, shader));
        out.push(Part {
            material,
            faces: owned,
        });
    }
    let rest: Vec<usize> = (0..faces).filter(|face| !taken[*face]).collect();
    // Ce qu'aucune liaison par faces n'a pris revient à la liaison entière quand il y en a une,
    // et sort sinon sans matériau : une face que le fichier écrit est une face de la scène.
    let whole = binds.iter().find(|(_, named)| named.is_none());
    if whole.is_none() {
        world
            .scene
            .report
            .add_count(report::FACE_MATERIAL_MISSING, rest.len());
    }
    let material = whole
        .and_then(|(shader, _)| *shader)
        .and_then(|shader| material::resolve(world, shader));
    if whole.is_some() || !rest.is_empty() {
        out.push(Part {
            material,
            faces: rest,
        });
    }
    out
}

/// Une part en primitive glTF, avec son nombre de triangles.
fn build(world: &mut World<'_>, surface: &Surface, part: &Part) -> Option<(Value, usize)> {
    let carried = |face: &usize| surface.uv_slots.get(*face).is_some_and(|uv| !uv.is_empty());
    let textured = !surface.uvs.is_empty() && part.faces.iter().all(carried);
    if !textured && !surface.uvs.is_empty() {
        world.refuse(report::UV_DROPPED);
    }
    let mut out = Vertices::default();
    let mut unique: HashMap<[u32; 3], u32> = HashMap::new();
    let mut cutter = Ngon::default();
    for (done, face) in part.faces.iter().enumerate() {
        // Le jeton est relu par tranche de faces : un seul maillage énorme s'arrête aussi. Ce qui
        // est déjà posé reste en place, et `convert` refuse la scène entière ensuite.
        if cancel::stopped(world.cancelled, done) {
            break;
        }
        let ring = surface.loops.get(*face).map_or(0, Vec::len);
        if ring < 3 {
            continue;
        }
        let corners: Vec<u32> = (0..ring)
            .filter_map(|rank| surface.corner(&mut out, &mut unique, (*face, rank), textured))
            .collect();
        if corners.len() != ring {
            continue;
        }
        if !surface.cut(&mut cutter, *face) {
            world.refuse(report::NGON_UNCUT);
        }
        for [a, b, c] in cutter.triangles() {
            out.indices.extend([corners[*a], corners[*b], corners[*c]]);
        }
    }
    if out.indices.is_empty() {
        return None;
    }
    let triangles = out.indices.len() / 3;
    let scene = &mut world.scene;
    let value = primitive(&out, &mut scene.bin, &mut scene.accessors, part.material);
    Some((value, triangles))
}
