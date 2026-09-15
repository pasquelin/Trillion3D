//! Un morceau de maillage en construction : les coins déjà émis, et les sommets qu'ils ont donnés.
//!
//! Un coin est un triplet (sommet, normale, coordonnée de texture). Deux coins qui portent le même
//! triplet sont un seul sommet du glTF ; deux coins qui n'en portent pas le même en font deux, car
//! le format n'a qu'un tableau de normales et un de coordonnées, indexés comme les positions.
use super::super::geom::Geometry;
use super::super::TOPOLOGY_INVALID;
use super::Part;
use crate::plugins::scene::ngon::Ngon;
use crate::{CompilerError, Result};
use std::collections::HashMap;

/// Un morceau en construction, avec la table des coins déjà émis.
#[derive(Default)]
pub(super) struct Builder {
    unique: HashMap<(u32, u32, u32), u32>,
    /// Le découpeur de polygones et les sommets de la face courante, réutilisés d'une face à
    /// l'autre : un maillage de mille faces n'alloue pas mille anneaux.
    cutter: Ngon,
    ring: Vec<u32>,
    positions: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    indices: Vec<u32>,
    min: [f32; 3],
    max: [f32; 3],
    started: bool,
}

impl Builder {
    /// Ajoute une face, lue à l'envers et découpée en oreilles. Rend `false` quand la face n'a pas
    /// donné toutes ses oreilles : elle sort alors en éventail, et l'appelant la compte.
    pub(super) fn face(
        &mut self,
        geometry: &Geometry,
        face: usize,
        corners: std::ops::Range<usize>,
    ) -> Result<bool> {
        // La face se lit à l'envers, coin par coin : chaque coin est émis une fois, dans cet ordre,
        // avant que le découpage ne dise quels triangles les relient.
        self.ring.clear();
        self.cutter.begin();
        for corner in corners.rev() {
            let rank = self.corner(geometry, face, corner)?;
            self.ring.push(rank);
            self.cutter.corner(point(geometry, corner));
        }
        let exact = self.cutter.cut();
        for triangle in self.cutter.triangles() {
            let corners = triangle.map(|rank| self.ring[rank]);
            self.indices.extend_from_slice(&corners);
        }
        Ok(exact)
    }

    /// Le rang glTF de ce coin, émis une seule fois par triplet distinct.
    fn corner(&mut self, geometry: &Geometry, face: usize, corner: usize) -> Result<u32> {
        let vertex = geometry
            .corners
            .get(corner)
            .copied()
            .and_then(|index| usize::try_from(index).ok())
            .filter(|vertex| (vertex + 1) * 3 <= geometry.positions.len())
            .ok_or_else(|| {
                CompilerError::new(
                    TOPOLOGY_INVALID,
                    "alembic: a face index falls outside the position table",
                )
            })?;
        let normal = geometry
            .normals
            .as_ref()
            .map_or(0, |param| param.slot(corner, vertex, face));
        let uv = geometry
            .uv
            .as_ref()
            .map_or(0, |param| param.slot(corner, vertex, face));
        let key = (u32::try_from(vertex).unwrap_or_default(), normal, uv);
        if let Some(known) = self.unique.get(&key) {
            return Ok(*known);
        }
        let rank = u32::try_from(self.unique.len()).unwrap_or_default();
        self.unique.insert(key, rank);
        self.push(geometry, vertex, normal, uv);
        Ok(rank)
    }

    /// Écrit les valeurs d'un nouveau sommet, et suit l'étendue des positions.
    fn push(&mut self, geometry: &Geometry, vertex: usize, normal: u32, uv: u32) {
        let position = &geometry.positions[vertex * 3..vertex * 3 + 3];
        for (axis, value) in position.iter().enumerate() {
            if !self.started {
                self.min[axis] = *value;
                self.max[axis] = *value;
            }
            self.min[axis] = self.min[axis].min(*value);
            self.max[axis] = self.max[axis].max(*value);
        }
        self.started = true;
        self.positions.extend_from_slice(position);
        if let Some(values) = geometry.normals.as_ref().and_then(|p| p.value(normal)) {
            self.normals.extend_from_slice(values);
        }
        // Le glTF place l'origine des coordonnées de texture en haut à gauche, Alembic en bas à
        // gauche : seule la seconde coordonnée change de sens, et l'aller-retour est exact.
        if let Some(values) = geometry.uv.as_ref().and_then(|p| p.value(uv)) {
            self.uvs.extend_from_slice(&[values[0], 1.0 - values[1]]);
        }
    }

    /// Le morceau fini. Un tableau d'attribut qui ne couvre pas tous les sommets n'entre pas dans le
    /// glTF, où chaque attribut a exactement autant d'éléments que de positions.
    pub(super) fn finish(self, faceset: Option<usize>) -> Part {
        let vertices = self.positions.len() / 3;
        let full = |values: Vec<f32>, width: usize| {
            if values.len() == vertices * width {
                values
            } else {
                Vec::new()
            }
        };
        Part {
            faceset,
            normals: full(self.normals, 3),
            uvs: full(self.uvs, 2),
            positions: self.positions,
            indices: self.indices,
            min: self.min,
            max: self.max,
        }
    }
}

/// La position du sommet d'un coin, en double, telle que le découpage la lit. Un coin hors des
/// tables donne l'origine : `corner` a déjà refusé le fichier dont les tableaux se contredisent.
fn point(geometry: &Geometry, corner: usize) -> [f64; 3] {
    let vertex = geometry
        .corners
        .get(corner)
        .copied()
        .and_then(|index| usize::try_from(index).ok())
        .unwrap_or_default();
    geometry
        .positions
        .get(vertex * 3..vertex * 3 + 3)
        .map_or([0.0; 3], |axes| {
            [f64::from(axes[0]), f64::from(axes[1]), f64::from(axes[2])]
        })
}
