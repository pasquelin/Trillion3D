//! The split a request asks for and what follows it (`Tessellation`): a point on an edge splits the
//! triangles on its two sides, any other point pokes the triangle; each triangle the split makes or
//! changes looks again, and an edge the split leaves badly shaped is flipped, the flip making the
//! triangles on its sides look again too.
use super::tessellate::{Record, Tessellation};
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{length, squared_length, sub};

/// A flip is made where the weight of its edge — the half sum of the cotangents of the angles
/// across it — falls under this.
const FLIP_WEIGHT: f32 = -1.0e-6;

impl Tessellation<'_> {
    /// Sets the displacement of `vertex`, growing the array to hold it.
    fn set_displacement(&mut self, vertex: usize, displacement: [f32; 3]) {
        if vertex >= self.displacements.len() {
            self.displacements.resize(vertex + 1, [f32::NAN; 3]);
        }
        self.displacements[vertex] = displacement;
    }

    /// Makes room for the records of triangles up to `count`.
    fn grow_records(&mut self, count: usize) {
        if count > self.records.len() {
            self.records.resize(count, Record::default());
        }
    }

    /// Asks `triangle` to look again for its point to split, once.
    fn ask_to_look(&mut self, triangle: usize) {
        let record = &mut self.records[triangle];
        if record.request != -2 {
            self.find.push(triangle as u32);
            record.request = -2;
        }
    }

    /// Takes the request of `triangle` out of the queue, the last request taking its place.
    fn remove_request(&mut self, triangle: usize) {
        let request = self.records[triangle].request;
        if let Ok(at) = usize::try_from(request) {
            let last = *self
                .splits
                .last()
                .expect("a pending request is in the queue");
            self.records[last as usize].request = request;
            self.splits.swap_remove(at);
            self.records[triangle].request = -1;
        }
    }

    /// The cotangent of the angle across edge `edge` of `triangle`.
    fn cotangent(&self, triangle: usize, edge: usize) -> f32 {
        let corners = self.mesh.triangle(triangle);
        let p0 = self.mesh.position(corners[edge]);
        let p1 = self.mesh.position(corners[(edge + 1) % 3]);
        let p2 = self.mesh.position(corners[(edge + 2) % 3]);
        let (edge01, edge12, edge20) = (sub(p1, p0), sub(p2, p1), sub(p0, p2));
        let area = 0.5 * length(cross(edge01, edge20));
        let squared = [edge01, edge12, edge20].map(squared_length);
        0.25 * (-squared[0] + squared[1] + squared[2]) / area
    }

    /// Flips edge `edge` of `triangle` when the triangles on its sides are better shaped for it —
    /// as Delaunay triangles are —, then the edges of the quad it leaves, each in turn, the same.
    pub(super) fn try_flip(&mut self, triangle: usize, edge: usize) {
        let mut pending = vec![(triangle, edge)];
        while let Some((triangle, edge)) = pending.pop() {
            if !self.could_flip(triangle, edge) {
                continue;
            }
            let Some((other, other_edge)) = self.mesh.across_edge(triangle, edge) else {
                continue;
            };
            let weight = 0.5 * (self.cotangent(triangle, edge) + self.cotangent(other, other_edge));
            let better = weight < FLIP_WEIGHT;
            if !better {
                continue;
            }
            let [first, second] = self.mesh.flip(triangle, edge);
            self.remove_request(triangle);
            self.remove_request(other);
            self.ask_to_look(triangle);
            self.ask_to_look(other);
            // The next edges of the first triangle, then of the second, the first of them first.
            pending.extend([(second, 1), (second, 2), (first, 2), (first, 1)]);
        }
    }

    /// Splits `triangle` at the point its request names.
    pub(super) fn split_triangle(&mut self, triangle: usize) {
        let bary = self.records[triangle].split;
        self.records[triangle].request = -1;
        if let Some(edge) = (0..3).find(|&edge| bary[(edge + 2) % 3] == 0.0) {
            self.split_edge(triangle, edge, bary[edge]);
            return;
        }
        let displacement = self.policy.in_triangle(&self.mesh, triangle, bary);
        let poke = self.mesh.poke(triangle, bary);
        self.grow_records(poke.triangles[1].max(poke.triangles[2]) + 1);
        self.set_displacement(poke.vertex, displacement);
        for made in poke.triangles {
            self.ask_to_look(made);
            self.try_flip(made, 0);
        }
    }

    /// Splits edge `edge` of `triangle` at `weight` of its first end: the vertex made on each side
    /// takes the displacement it has there — a vertex both sides share, the mean of the two.
    fn split_edge(&mut self, triangle: usize, edge: usize, weight: f32) {
        let split = self.mesh.split_edge(triangle, edge, weight);
        for j in 0..split.count {
            let vertex = split.vertex[j];
            let here = self
                .policy
                .of_vertex(&self.mesh, vertex as u32, split.old[j]);
            if j == 1 && split.vertex[1] == split.vertex[0] {
                let first = self.displacements[vertex];
                let mean = [0, 1, 2].map(|k| 0.5 * (first[k] + here[k]));
                self.displacements[vertex] = mean;
            } else {
                self.set_displacement(vertex, here);
            }
        }
        let last = if split.count == 2 {
            split.new[1]
        } else {
            split.new[0]
        };
        self.grow_records(last + 1);
        for j in 0..split.count {
            self.remove_request(split.old[j]);
            self.ask_to_look(split.old[j]);
            self.ask_to_look(split.new[j]);
            self.try_flip(split.old[j], 1);
            self.try_flip(split.new[j], 2);
        }
    }
}
