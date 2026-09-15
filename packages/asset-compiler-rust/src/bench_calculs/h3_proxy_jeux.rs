//! Les entrées du point H3 : des scènes engendrées par le xorshift à graine fixe du banc, plus une
//! scène écrite en clair. Elles sèment exprès ce que le placement doit écarter — maillage non
//! compilé, primitive sans champ `mesh`, `mesh` textuel, primitive sans coupe, coupe vide.
use super::super::inputs::Xorshift;
use crate::proxy::ProxyInputs;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// Un jeu du banc : la scène, les nœuds retenus, les primitives compilées et leurs coupes.
pub(crate) struct Jeu {
    g: Value,
    chosen: BTreeSet<usize>,
    mesh_map: BTreeMap<usize, usize>,
    primitives: Vec<Value>,
    cuts: Vec<Vec<f32>>,
    thresholds: Vec<f64>,
}
impl Jeu {
    pub(crate) fn inputs(&self) -> ProxyInputs<'_> {
        ProxyInputs {
            g: &self.g,
            chosen: &self.chosen,
            mesh_map: &self.mesh_map,
            primitives: &self.primitives,
            cuts: &self.cuts,
            thresholds: &self.thresholds,
            previews: &[],
        }
    }
}

/// Une coupe d'un triangle, vide une sur sept : le placement doit sauter celles-là sans que l'ordre
/// d'écriture des autres bouge.
fn cut(rng: &mut Xorshift, slot: usize) -> Vec<f32> {
    if slot % 7 == 3 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(9);
    for _ in 0..3 {
        out.extend_from_slice(&[rng.coordinate(), rng.coordinate(), rng.coordinate()]);
    }
    out
}

/// Les primitives compilées : une sur cent quarante-trois sans champ `mesh`, une autre avec un
/// `mesh` textuel, une sur dix-sept sans matériau. Les trois doivent être écartées ou repliées de la
/// même façon des deux côtés, et c'est justement ce que la table indexée doit reproduire.
fn primitive(rng: &mut Xorshift, slot: usize, meshes: usize) -> Value {
    let mesh = rng.below(meshes);
    let material = if slot % 17 == 5 {
        Value::Null
    } else {
        json!(rng.below(8))
    };
    match slot % 143 {
        11 => json!({ "material": material }),
        13 => json!({"mesh": mesh.to_string(), "material": material}),
        _ => json!({"mesh": mesh, "material": material}),
    }
}

/// `nodes` nœuds posés sur `meshes` maillages sources, dont un sur quatre n'est pas compilé, et
/// `count` primitives réparties sur les maillages compilés. Les quatre dernières primitives n'ont
/// pas de coupe : `cuts` est plus court qu'elles, comme quand une coupe a échoué.
fn jeu(seed: u64, nodes: usize, meshes: usize, count: usize) -> Jeu {
    let mut rng = Xorshift::new(seed);
    let mesh_map: BTreeMap<usize, usize> = (0..meshes)
        .filter(|old| old % 4 != 3)
        .enumerate()
        .map(|(index, old)| (old, index))
        .collect();
    let compiled = mesh_map.len().max(1);
    let node_values: Vec<Value> = (0..nodes)
        .map(|_| {
            json!({"mesh": rng.below(meshes),
              "translation":[rng.coordinate(), rng.coordinate(), rng.coordinate()],
              "scale":[0.5, 1.5, -1.0]})
        })
        .collect();
    let primitives: Vec<Value> = (0..count)
        .map(|slot| primitive(&mut rng, slot, compiled))
        .collect();
    Jeu {
        g: json!({"nodes": node_values, "materials": materials(8)}),
        chosen: (0..nodes).collect(),
        mesh_map,
        primitives,
        cuts: (0..count.saturating_sub(4))
            .map(|slot| cut(&mut rng, slot))
            .collect(),
        thresholds: (0..count).map(|slot| slot as f64 / 1000.0).collect(),
    }
}

fn materials(count: usize) -> Vec<Value> {
    (0..count)
        .map(|id| json!({"pbrMetallicRoughness":{"baseColorFactor":[id as f64/8.0,0.5,1.0,1.0]}}))
        .collect()
}

/// Les trois formes que le balayage rencontre, plus une scène dense qui les mêle.
pub(crate) fn jeux() -> Vec<Jeu> {
    vec![
        // Peu de nœuds, beaucoup de maillages : le balayage coûte cher pour deux cents triangles.
        jeu(0x9E37_79B1, 200, 6_000, 6_000),
        // Beaucoup de nœuds qui partagent peu de maillages : chacun replace les mêmes coupes.
        jeu(0x2545_F491, 3_000, 12, 24),
        // Des nœuds sans primitive : maillage non compilé, ou compilé mais qu'aucune ne porte.
        jeu(0x1D87_2E4F, 2_000, 400, 40),
        // Une scène dense : autant de nœuds que de primitives, sur moitié moins de maillages.
        jeu(0x6C07_8965, 4_000, 2_000, 4_000),
    ]
}

/// Une scène écrite en clair, dont on compte les coupes posées à la main : quatre nœuds — deux qui
/// partagent le maillage 0, un sur le maillage 1 que personne n'a compilé, un sur le maillage 2 —
/// et cinq primitives dont une sans `mesh`, une sur un maillage qu'aucun nœud ne porte et une sans
/// coupe. Cinq coupes doivent être posées : le maillage 0 en porte deux, placé deux fois, plus une
/// pour le maillage 2. Les coupes tiennent sur la grille du proxy et sont assez écartées pour que
/// ni la fusion ni le budget n'entrent en jeu.
pub(crate) fn clair() -> (Jeu, usize) {
    let noeud = |mesh: usize, x: f64| json!({"mesh": mesh, "translation": [x, 0.0, 0.0]});
    let triangle = |x: f32| vec![x, 0.0, 0.0, x + 0.5, 0.0, 0.0, x, 0.5, 0.0];
    let jeu = Jeu {
        g: json!({"nodes":[noeud(0,0.0),noeud(1,50.0),noeud(0,100.0),noeud(2,200.0)],
          "materials": materials(2)}),
        chosen: (0..4).collect(),
        mesh_map: BTreeMap::from([(0, 0), (2, 1)]),
        primitives: vec![
            json!({"mesh":0,"material":0}),
            json!({ "material": 1 }),
            json!({"mesh":1,"material":1}),
            json!({"mesh":0,"material":1}),
            json!({ "mesh": 0 }),
        ],
        cuts: vec![
            triangle(0.0),
            triangle(10.0),
            triangle(20.0),
            triangle(30.0),
        ],
        thresholds: vec![0.01, 0.02, 0.03, 0.04, 0.05],
    };
    (jeu, 5)
}
