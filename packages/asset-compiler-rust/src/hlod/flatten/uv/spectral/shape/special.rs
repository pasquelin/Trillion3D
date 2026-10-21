//! Trivial shapes, cylinders and horns, as the spectrum shows them.
//!
//! Trivial: a chart of no primary dimension has collapsed to a point (every vertex at the origin,
//! stretch 1, no plane area); a chart of one face is laid flat. Either keeps no child.
//!
//! Special: only with 3 computed dimensions or more, and not when the stretch bound is loose
//! enough (at least the bound of 0.95) for one boundary to be laid flat by barycentric
//! coordinates. With `e` the eigenvalues, the second and third above `ZERO`: a cylinder when the
//! fourth is computed and above `ZERO` and `e0/e2 < 20`, `e0/e3 > 18`, `e1/e2 < 5`, `e2/e3 > 2`;
//! with one boundary only, a horn when `e0/e1 > 10`. The extreme vertex: the inner vertex lowest
//! in the first coordinate when the boundary vertex farthest from zero in it lies above zero,
//! else the highest. Either shape holds only when every boundary vertex's edge-path distance to
//! it lies between half and twice their mean; a cylinder is no horn.
use crate::hlod::flatten::uv::spectral::criteria::{internal_criterion, BARYCENTRIC_STRETCH};
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};
use crate::hlod::flatten::uv::spectral::partition::Embedding;
use crate::hlod::flatten::uv::spectral::util::near_zero;

/// What the spectrum tells of a chart's shape.
struct Tube {
    cylinder: bool,
    horn: bool,
    /// The horn's extreme vertex.
    extreme: u32,
}

impl<'a> Chart<'a> {
    /// The chart laid out when its shape is trivial; whether it was.
    pub(crate) fn process_trivial(&mut self, primary: usize) -> bool {
        if primary == 0 {
            for v in &mut self.verts {
                v.uv = [0.0, 0.0];
            }
            self.children.clear();
            self.stretch_l2 = 1.0;
            self.area_2d = 0.0;
            return true;
        }
        if self.faces.len() <= 1 {
            self.parameterize_one_face(self.has_signal(), 0);
            self.children.clear();
            return true;
        }
        false
    }

    /// The chart cut when it is a cylinder or a horn; whether it is one.
    pub(crate) fn process_special(
        &mut self,
        boundaries: usize,
        embedding: &Embedding,
    ) -> crate::Result<bool> {
        let loose = internal_criterion(BARYCENTRIC_STRETCH, false);
        if self.source.expected_l2.get() >= loose && boundaries == 1 {
            return Ok(false);
        }
        if embedding.computed < 3 {
            return Ok(false);
        }
        let tube = self.recognise_tube(boundaries);
        let succeeded = if tube.cylinder {
            self.cut_cylinder(&embedding.geodesic, &embedding.coords, embedding.primary)?
        } else if tube.horn {
            self.cut_horn(&embedding.geodesic, tube.extreme)?
        } else {
            false
        };
        if !succeeded {
            self.children.clear();
        }
        Ok(tube.cylinder || tube.horn)
    }

    /// Whether the chart is a cylinder or a horn.
    fn recognise_tube(&mut self, boundaries: usize) -> Tube {
        let mut tube = Tube {
            cylinder: false,
            horn: false,
            extreme: 0,
        };
        let e = self.spectrum.values();
        if near_zero(e[1]) || near_zero(e[2]) {
            return tube;
        }
        let (ratio01, ratio02, ratio12) = (e[0] / e[1], e[0] / e[2], e[1] / e[2]);
        if self.spectrum.calculated() > 3 && !near_zero(e[3]) {
            let (ratio03, ratio23) = (e[0] / e[3], e[2] / e[3]);
            if ratio02 < 20.0 && ratio03 > 18.0 && ratio12 < 5.0 && ratio23 > 2.0 {
                tube.cylinder = true;
            }
        }
        if boundaries != 1 {
            return tube;
        }
        if ratio01 > 10.0 {
            tube.horn = true;
        }
        let extreme = self.extreme_vertex();
        if extreme == NONE {
            tube.cylinder = false;
            tube.horn = false;
            return tube;
        }
        let (mean, least, most) = self.boundary_distances_to(extreme);
        if least > mean / 2.0 && most < mean * 2.0 {
            tube.extreme = extreme;
        } else {
            tube.cylinder = false;
            tube.horn = false;
        }
        if tube.cylinder {
            tube.horn = false;
        }
        tube
    }

    /// The inner vertex at the far end of the first coordinate from the boundary; `NONE` when the
    /// chart has no boundary or no inner vertex.
    fn extreme_vertex(&self) -> u32 {
        let mut farthest = -f32::MAX;
        let mut found = NONE;
        for (i, v) in self.verts.iter().enumerate() {
            if v.boundary && v.uv[0].abs() > farthest {
                found = i as u32;
                farthest = v.uv[0].abs();
            }
        }
        if found == NONE {
            return NONE;
        }
        let above = self.verts[found as usize].uv[0] > 0.0;
        found = NONE;
        let mut best = if above { f32::MAX } else { -f32::MAX };
        for (i, v) in self.verts.iter().enumerate() {
            if v.boundary {
                continue;
            }
            let better = if above {
                v.uv[0] < best
            } else {
                v.uv[0] > best
            };
            if better {
                found = i as u32;
                best = v.uv[0];
            }
        }
        found
    }

    /// The mean, least and largest edge-path distance from vertex `v` to the boundary vertices.
    fn boundary_distances_to(&mut self, v: u32) -> (f32, f32, f32) {
        self.dijkstra_from(v);
        let (mut least, mut most, mut sum) = (f32::MAX, -f32::MAX, 0.0f32);
        let mut count = 0usize;
        for vert in self.verts.iter().filter(|v| v.boundary) {
            sum += vert.geodesic;
            count += 1;
            if vert.geodesic < least {
                least = vert.geodesic;
            }
            if vert.geodesic > most {
                most = vert.geodesic;
            }
        }
        (sum / count as f32, least, most)
    }
}
