//! Proxy résident : la géométrie que les rayons de lumière touchent.
//!
//! Un rayon de lumière ne peut pas tracer la coupe visible : elle dépend de la caméra, elle change
//! à chaque image, et ses feuilles sont trop fines pour un budget de rayons. Le compilateur retient
//! donc une fois pour toutes un niveau grossier du DAG — les clusters dont l'erreur géométrique
//! certifiée passe sous un seuil en mètres — les place dans le monde, leur donne l'albédo de leur
//! matériau, et construit un BVH par-dessus. Le tout tient dans le cache et reste résident en
//! mémoire graphique quel que soit le point de vue.
//!
//! Aucune lumière n'est cuite ici : le proxy porte de la géométrie et des matériaux, rien d'autre.
use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::{transform_point, world_matrices, Mat4};
use crate::texture_preview::TexturePreview;
use crate::Result;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub mod albedo;
pub mod bvh;
pub mod cut;
pub mod encode;
pub mod simplify;
pub mod wide;

/// Contrat du produit. Bouger la coupe, les sections ou l'ordre des nœuds impose de l'incrémenter.
pub const SCENE_PROXY_VERSION: u32 = 2;
/// 'W','G','P','X' lus comme un entier non signé de 32 bits en petit-boutiste.
pub const SCENE_PROXY_MAGIC: u32 = 0x5850_4757;
/// Entiers d'en-tête : signature, version, triangles, nœuds.
pub const SCENE_PROXY_HEADER_WORDS: usize = 4;
/// Nom du produit dans le dossier de la clé de cache, à côté de `clusters.json`.
pub const SCENE_PROXY_FILE: &str = "proxy.bin";
/// Erreur géométrique certifiée maximale d'un cluster retenu, en mètres. Réglage publié (LC1).
pub const PROXY_ERROR_METRES: f64 = 0.05;
/// Plancher de la maille du proxy, en mètres : la taille d'un triangle après simplification, donc
/// la résolution du cache de surfaces du moteur. Le budget de triangles la double si besoin.
pub const PROXY_CELL_METRES: f64 = 0.5;
/// Triangles d'une feuille du BVH : la boucle d'une feuille est bornée par ce nombre côté moteur.
pub const PROXY_LEAF_TRIANGLES: usize = 8;
/// Triangles que le proxy d'une scène entière s'autorise, toutes instances posées. C'est ce budget
/// qui décide du seuil réellement obtenu : une scène de dix millions de triangles sort trente fois
/// plus grossière qu'une pièce, et le seuil qu'elle a dû prendre est publié dans le manifeste.
pub const PROXY_TRIANGLE_BUDGET: usize = 300_000;
/// Nombres par triangle : trois sommets monde. La normale se déduit du triangle, jamais stockée.
pub const PROXY_TRIANGLE_FLOATS: usize = 9;
/// Nombres par nœud : bornes basses puis hautes, exactes, qui servent aussi de repère aux boîtes
/// quantifiées de ses enfants.
pub const PROXY_NODE_FLOATS: usize = 6;
/// Enfants d'un nœud du BVH : quatre boîtes testées d'un coup, la plus proche gardée pour la suite.
pub const PROXY_CHILDREN: usize = 4;
/// Entiers par enfant : deux mots de boîte quantifiée et de liens, puis le lien lui-même.
pub const PROXY_CHILD_WORDS: usize = 3;
/// Entiers par nœud : ses quatre enfants bout à bout.
pub const PROXY_NODE_WORDS: usize = PROXY_CHILDREN * PROXY_CHILD_WORDS;

/// Le proxy d'une scène, prêt à être écrit en colonnes.
#[derive(Default)]
pub struct SceneProxy {
    pub bounds: [f64; 6],
    /// Le plus grand seuil qu'une primitive a dû prendre pour tenir dans sa part du budget, plus
    /// ce que la simplification propre au proxy y a ajouté.
    pub error_metres: f64,
    /// Le pas de grille que la simplification a pris, en mètres : la taille d'un triangle du proxy,
    /// donc aussi celle d'une maille du cache de surfaces.
    pub cell_metres: f64,
    pub triangles: Vec<f32>,
    pub albedo: Vec<u32>,
    pub node_bounds: Vec<f32>,
    pub node_children: Vec<u32>,
}
impl SceneProxy {
    pub fn triangle_count(&self) -> usize {
        self.triangles.len() / PROXY_TRIANGLE_FLOATS
    }
    pub fn node_count(&self) -> usize {
        self.node_children.len() / PROXY_NODE_WORDS
    }
}

/// Ce que l'étape lit : la scène, les coupes grossières déjà retenues et les aperçus de texture.
pub struct ProxyInputs<'a> {
    pub g: &'a Value,
    pub chosen: &'a BTreeSet<usize>,
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub primitives: &'a [Value],
    /// Par primitive compilée : les sommets de sa coupe grossière, en espace objet.
    pub cuts: &'a [Vec<f32>],
    /// Par primitive compilée : le seuil que sa coupe a demandé, en mètres.
    pub thresholds: &'a [f64],
    pub previews: &'a [TexturePreview],
}

/// Facteur d'échelle d'une matrice monde : la plus longue de ses trois colonnes linéaires. C'est de
/// quoi une erreur objet est multipliée en devenant une erreur monde, à la borne supérieure près.
pub fn world_scale(matrix: &Mat4) -> f64 {
    (0..3)
        .map(|column| {
            (matrix[column * 4].powi(2)
                + matrix[column * 4 + 1].powi(2)
                + matrix[column * 4 + 2].powi(2))
            .sqrt()
        })
        .fold(0.0f64, f64::max)
}

/// L'échelle monde maximale sous laquelle chaque maillage source est placé. Une primitive posée
/// deux fois à deux échelles prend la plus grande : la coupe est alors plus fine que nécessaire à
/// l'autre instance, jamais plus grossière que le seuil ne l'autorise.
pub fn mesh_scales(g: &Value, chosen: &BTreeSet<usize>) -> Result<BTreeMap<usize, f64>> {
    let world = world_matrices(g)?;
    let nodes = values(g, "nodes")?;
    let mut scales: BTreeMap<usize, f64> = BTreeMap::new();
    for node_id in chosen {
        let node = item(nodes, *node_id, "node")?;
        let mesh = required_index(node.get("mesh"), "node.mesh")?;
        let scale = world_scale(&world[*node_id]);
        let slot = scales.entry(mesh).or_insert(0.0);
        if scale > *slot {
            *slot = scale;
        }
    }
    Ok(scales)
}

/// Place chaque coupe grossière dans le monde, une fois par nœud qui la porte, puis construit le
/// BVH. Une primitive posée dix fois donne dix jeux de triangles : le proxy est une scène, pas un
/// catalogue d'objets, et un rayon n'a pas de matrice à appliquer.
pub fn stage_proxy(inputs: &ProxyInputs<'_>) -> Result<SceneProxy> {
    let world = world_matrices(inputs.g)?;
    let nodes = values(inputs.g, "nodes")?;
    let palette = albedo::material_albedo(inputs.g, inputs.previews);
    let mut triangles: Vec<f32> = Vec::new();
    let mut colours: Vec<u32> = Vec::new();
    for node_id in inputs.chosen {
        let node = item(nodes, *node_id, "node")?;
        let old_mesh = required_index(node.get("mesh"), "node.mesh")?;
        let Some(mesh_index) = inputs.mesh_map.get(&old_mesh).copied() else {
            continue;
        };
        let matrix = world[*node_id];
        for (index, primitive) in inputs.primitives.iter().enumerate() {
            if primitive.get("mesh").and_then(Value::as_u64) != Some(mesh_index as u64) {
                continue;
            }
            let Some(cut) = inputs.cuts.get(index) else {
                continue;
            };
            let colour = palette.of(primitive.get("material"));
            place(cut, &matrix, &mut triangles);
            colours.resize(triangles.len() / PROXY_TRIANGLE_FLOATS, colour);
        }
    }
    // La coupe du DAG s'arrête à sa racine ; la simplification du proxy, elle, va aussi loin qu'il
    // le faut, et donne au passage des triangles de taille bornée au cache de surfaces.
    let cell = simplify::plan_cell(&triangles, PROXY_CELL_METRES, PROXY_TRIANGLE_BUDGET);
    simplify::simplify(&mut triangles, &mut colours, cell);
    let (node_bounds, node_children) = wide::collapse(&bvh::build(&mut triangles, &mut colours));
    let cut_error = inputs
        .thresholds
        .iter()
        .copied()
        .fold(PROXY_ERROR_METRES, f64::max);
    Ok(SceneProxy {
        bounds: bvh::extent(&triangles),
        error_metres: cut_error + cell * simplify::CELL_ERROR_FACTOR,
        cell_metres: cell,
        triangles,
        albedo: colours,
        node_bounds,
        node_children,
    })
}

/// Les sommets d'une coupe, transformés une fois par le nœud qui la place.
fn place(cut: &[f32], matrix: &Mat4, out: &mut Vec<f32>) {
    out.reserve(cut.len());
    for vertex in cut.as_chunks::<3>().0 {
        let world = transform_point(
            matrix,
            [vertex[0] as f64, vertex[1] as f64, vertex[2] as f64],
        );
        out.push(world[0] as f32);
        out.push(world[1] as f32);
        out.push(world[2] as f32);
    }
}
