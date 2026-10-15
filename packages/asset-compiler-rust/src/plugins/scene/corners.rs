//! Polygon faces into a glTF primitive, the one builder of every driver that reads faces: each
//! corner becomes a vertex once per distinct key, each face is cut by ears (`Ngon`).
//!
//! A driver says what identifies a corner — the slots of its position, normal and texture
//! coordinate in its own tables, or the bits of their values — and what the vertex carries when
//! first met. Two corners with the same key are one vertex: equality decides, never a distance.
use super::ngon::Ngon;
use crate::import::Vertices;
use std::{hash::Hash, sync::atomic::AtomicBool};
use trillion3d_page_codec::hash::{word_map, WordMap};

/// A face whose ear cut had to be forced — a self-intersecting polygon, or one with no plane: it
/// came out fanned from its first corner, which can fill it beyond its silhouette. One code for
/// every driver, the format being the report's own.
pub(crate) const NGON_UNCUT: &str = "ngon-untriangulable";

/// glTF places the texture origin at the top left; every format this crate reads by faces places
/// it at the bottom left. Only the second coordinate turns, and the round trip is exact.
pub(crate) fn gltf_uv([u, v]: [f32; 2]) -> [f32; 2] {
    [u, 1.0 - v]
}

/// A primitive under construction: its vertices, the vertex of each key met, and the open face.
pub(crate) struct Corners<K> {
    pub(crate) vertices: Vertices,
    /// Keys are words: hashed word by word, the cost of mesh conversion.
    unique: WordMap<K, u32>,
    /// The cutter and the open face's vertex ranks, reused from one face to the next.
    cutter: Ngon,
    ring: Vec<u32>,
    /// Faces whose ear cut had to be forced: they came out fanned, and the driver counts them.
    pub(crate) uncut: usize,
}

impl<K: Hash + Eq> Corners<K> {
    /// A builder pouring into `vertices`, which may already carry empty morph targets.
    pub(crate) fn new(vertices: Vertices) -> Self {
        Self {
            vertices,
            unique: word_map(0),
            cutter: Ngon::default(),
            ring: Vec::new(),
            uncut: 0,
        }
    }

    /// Opens a face: corners are then given in its walk order.
    pub(crate) fn begin(&mut self) {
        self.ring.clear();
        self.cutter.begin();
    }

    /// Adds a corner at `point`, keyed `key`; `write` pours its vertex the first time the key is
    /// met. Yields the vertex rank.
    pub(crate) fn corner(
        &mut self,
        key: K,
        point: [f64; 3],
        write: impl FnOnce(&mut Vertices),
    ) -> u32 {
        let next = self.unique.len() as u32;
        let rank = *self.unique.entry(key).or_insert_with(|| {
            write(&mut self.vertices);
            next
        });
        self.ring.push(rank);
        self.cutter.corner(point);
        rank
    }

    /// Cuts the open face and emits its triangles, each walked backwards when `reversed`.
    /// `None` when the cancellation token is raised (the cutter rereads it by face slice).
    pub(crate) fn cut(&mut self, cancelled: &AtomicBool, reversed: bool) -> Option<()> {
        if !self.cutter.cut(cancelled)? {
            self.uncut += 1;
        }
        for [a, b, c] in self.cutter.triangles() {
            let [a, b, c] = [a, b, c].map(|rank| self.ring[*rank]);
            let triangle = if reversed { [a, c, b] } else { [a, b, c] };
            self.vertices.indices.extend(triangle);
        }
        Some(())
    }
}
