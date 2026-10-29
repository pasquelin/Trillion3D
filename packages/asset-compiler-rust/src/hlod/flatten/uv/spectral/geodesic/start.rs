//! A run of the propagation: its start from the source's opposite edges, its loop, and the
//! distance of the vertices no window reached.
//!
//! Starting clears every window and distance, then lays a whole window on each edge that does not
//! touch the source but bounds one of the source's faces, unfolded from that face. The loop takes
//! windows until the heap is empty. A used vertex still at the largest float then reads each
//! window of its edges: the window that ends nearest it gives its distance, the least distance
//! among equally near ones.
use super::plane::{distance, into_frame_3d};
use super::{Window, Windows};
use crate::hlod::flatten::uv::extremes::lesser;
use crate::hlod::flatten::uv::spectral::mesh::NONE;

impl Windows {
    /// Every distance from vertex `source`.
    pub(crate) fn run(&mut self, source: u32) {
        self.start(source);
        while !self.heap.is_empty() {
            let window = self.pop_window();
            self.propagate(&window);
        }
        self.settle_unreached();
    }

    fn start(&mut self, source: u32) {
        while let Some(id) = self.heap.pop() {
            self.free.push(id);
        }
        for v in &mut self.verts {
            v.distance = f32::MAX as f64;
            v.window_gap = f32::MAX as f64;
            v.shadow = false;
        }
        for i in 0..self.edges.len() {
            self.edges[i].windows.clear();
            let edge = &self.edges[i];
            let touches = |f: u32| f != NONE && self.faces[f as usize].verts.contains(&source);
            if edge.verts.contains(&source) || !(touches(edge.faces[0]) || touches(edge.faces[1])) {
                continue;
            }
            let p = self.verts[source as usize].p;
            let (a, b) = (
                self.verts[edge.verts[0] as usize].p,
                self.verts[edge.verts[1] as usize].p,
            );
            let window = Window {
                edge: i as u32,
                mark: edge.verts[0],
                pseudo: source,
                b0: 0.0,
                b1: edge.length,
                d0: distance(a, p),
                d1: distance(b, p),
                src: into_frame_3d(a, b, p),
                pseudo_distance: 0.0,
                from_face: if self.faces[edge.faces[0] as usize].verts.contains(&source) {
                    edge.faces[0]
                } else {
                    edge.faces[1]
                },
                ksi: 0.0,
            };
            self.add_window(window);
        }
        self.verts[source as usize].distance = 0.0;
    }

    /// `window` held and listed on its edge, its ends' distances lowered.
    fn add_window(&mut self, window: Window) {
        let edge = self.list(window);
        let other = edge.other_end(window.mark);
        for (v, d) in [(window.mark, window.d0), (other, window.d1)] {
            let vert = &mut self.verts[v as usize];
            vert.distance = lesser(vert.distance, d + window.pseudo_distance);
            vert.window_gap = 0.0;
        }
    }

    fn settle_unreached(&mut self) {
        for i in 0..self.verts.len() {
            if !self.verts[i].used || self.verts[i].distance != f32::MAX as f64 {
                continue;
            }
            for j in 0..self.verts[i].edges.len() {
                let e = self.verts[i].edges[j] as usize;
                for l in 0..self.edges[e].windows.len() {
                    let w = self.edges[e].windows[l].window;
                    let length = self.edges[e].length;
                    if w.mark == i as u32 {
                        let vert = &mut self.verts[w.mark as usize];
                        if w.b0 < vert.window_gap {
                            vert.window_gap = w.b0;
                            vert.distance = w.d0 + w.pseudo_distance;
                        } else if w.b0 == vert.window_gap {
                            vert.distance = lesser(vert.distance, w.d0 + w.pseudo_distance);
                        }
                    } else {
                        let vert = &mut self.verts[i];
                        if w.b1 > length - vert.window_gap {
                            vert.window_gap = length - w.b1;
                            vert.distance = w.d1 + w.pseudo_distance;
                        } else if w.b1 == length - vert.window_gap {
                            vert.distance = lesser(vert.distance, w.d1 + w.pseudo_distance);
                        }
                    }
                }
            }
        }
    }
}
