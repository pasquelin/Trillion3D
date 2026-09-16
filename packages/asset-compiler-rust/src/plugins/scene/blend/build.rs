//! De la géométrie lue aux primitives glTF : une primitive par matériau, n-gones coupés en oreilles.
//!
//! Blender range l'indice de matériau à la face ; le glTF le range à la primitive. Les faces sont
//! donc regroupées par emplacement de matériau, dans l'ordre croissant des emplacements, et chaque
//! groupe devient une primitive avec ses propres accesseurs. Deux coins qui portent exactement le
//! même sommet, la même normale et la même coordonnée de texture ne sont écrits qu'une fois ; rien
//! n'est arrondi ni fusionné au-delà de cette égalité exacte.
//!
//! Une seule conversion touche les coordonnées de texture : Blender place leur origine en bas à
//! gauche, le glTF en haut à gauche, donc `v` devient `1 - v`. C'est la convention des pilotes ma,
//! alembic et usd, et elle laisse les octets des images intacts.
use super::*;
use crate::plugins::scene::{cancel, ngon::Ngon};

/// Une face que la coupe par oreilles n'a pas su découper entièrement : polygone qui se recoupe, ou
/// sans plan — coins tous alignés, aire nulle. Elle sort en éventail depuis son premier coin, ce
/// qui peut la remplir au-delà de sa silhouette, et c'est ce que ce compte dit.
const NGON_UNCUT: &str = "blend-ngon-untriangulable";

/// Les tableaux d'une primitive en construction.
#[derive(Default)]
struct Primitive {
    positions: Vec<f32>,
    normals: Vec<f32>,
    uv: Vec<f32>,
    indices: Vec<u32>,
    seen: HashMap<[u32; 6], u32>,
}

/// Construit le maillage glTF d'une géométrie et rend son JSON et son nombre de triangles.
/// `slots` donne le matériau de chaque emplacement du maillage, quand il en a un. Le jeton
/// d'annulation est relu par tranche de faces : un seul maillage énorme s'arrête aussi.
pub(super) fn mesh_json(
    geometry: &Geometry,
    normals: &[f32],
    slots: &[Option<usize>],
    name: &str,
    out: &mut Out,
    cancelled: &AtomicBool,
) -> Result<(Value, usize)> {
    let mut groups: BTreeMap<u32, Primitive> = BTreeMap::new();
    let mut cutter = Ngon::default();
    for face in 0..geometry.faces() {
        let first = geometry.offsets[face] as usize;
        cutter.begin();
        for vertex in geometry.face(face) {
            cutter.corner(slice3(&geometry.positions, *vertex as usize).map(f64::from));
        }
        let Some(exact) = cutter.cut(cancelled) else {
            return Err(cancel::refusal());
        };
        if !exact {
            out.count(NGON_UNCUT, 1);
        }
        let group = groups.entry(geometry.material[face]).or_default();
        for triangle in cutter.triangles() {
            for rank in triangle {
                let vertex = group.vertex(geometry, normals, first + rank);
                group.indices.push(vertex);
            }
        }
    }
    let mut primitives = Vec::new();
    let mut triangles = 0;
    for (slot, group) in groups {
        if group.indices.is_empty() {
            continue;
        }
        triangles += group.indices.len() / 3;
        let mut attributes = json!({
            "POSITION": out.floats(&group.positions, 3, true),
            "NORMAL": out.floats(&group.normals, 3, false),
        });
        if !group.uv.is_empty() {
            attributes["TEXCOORD_0"] = json!(out.floats(&group.uv, 2, false));
        }
        let mut primitive = json!({
            "attributes": attributes, "indices": out.indices(&group.indices), "mode": 4,
        });
        if let Some(Some(material)) = slots.get(slot as usize) {
            primitive["material"] = json!(material);
        }
        primitives.push(primitive);
    }
    Ok((json!({"name": name, "primitives": primitives}), triangles))
}

impl Primitive {
    /// Le rang du sommet de ce coin dans cette primitive, versé à sa première rencontre.
    fn vertex(&mut self, geometry: &Geometry, normals: &[f32], corner: usize) -> u32 {
        let vertex = geometry.corners[corner];
        let normal = slice3(normals, corner);
        let uv = if geometry.uv.is_empty() {
            [0.0, 0.0]
        } else {
            // Blender place l'origine des UV en bas à gauche, le glTF en haut à gauche : seule la
            // coordonnée V change de sens, et les octets de l'image ne sont jamais retouchés.
            [geometry.uv[corner * 2], 1.0 - geometry.uv[corner * 2 + 1]]
        };
        let key = [
            vertex,
            normal[0].to_bits(),
            normal[1].to_bits(),
            normal[2].to_bits(),
            uv[0].to_bits(),
            uv[1].to_bits(),
        ];
        if let Some(known) = self.seen.get(&key) {
            return *known;
        }
        let rank = (self.positions.len() / 3) as u32;
        self.positions
            .extend_from_slice(&slice3(&geometry.positions, vertex as usize));
        self.normals.extend_from_slice(&normal);
        if !geometry.uv.is_empty() {
            self.uv.extend_from_slice(&uv);
        }
        self.seen.insert(key, rank);
        rank
    }
}

/// Les trois flottants d'un rang, ou trois zéros quand le tableau ne les porte pas.
fn slice3(values: &[f32], rank: usize) -> [f32; 3] {
    values
        .get(rank * 3..rank * 3 + 3)
        .map_or([0.0; 3], |found| [found[0], found[1], found[2]])
}
