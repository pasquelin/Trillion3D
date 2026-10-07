//! How far a deformed primitive can move: the rest-pose ball of the vertices each joint
//! moves and each target's largest displacement, which the runtime inflates a cluster's bounds by
//! so that culling never drops a visible deformed cluster.
use super::Deformation;
use trillion3d_math::aabb::{centre, extend_aabb};
use trillion3d_math::vec3::{length, sub};

impl Deformation {
    /// Whole-copy soft geometry names compact simulation vertices explicitly, without page streams.
    pub fn reach_for_pass(&self, positions: &[f32], whole: bool) -> serde_json::Value {
        let mut reach = self.reach(positions);
        if whole && self.soft_source.is_some() {
            reach["softSourceIds"] = serde_json::json!(self
                .skin
                .as_ref()
                .unwrap()
                .0
                .iter()
                .step_by(self.influences)
                .collect::<Vec<_>>());
        }
        reach
    }

    /// What the runtime inflates a deformed cluster's bounds by: for each joint the ball
    /// of the rest-pose vertices it moves, `[x, y, z, radius]`, and each target's largest
    /// displacement; `null` on a primitive that does not deform.
    pub fn reach(&self, positions: &[f32]) -> serde_json::Value {
        if self.skin.is_none() && self.targets.is_empty() {
            return serde_json::Value::Null;
        }
        let mut balls: Vec<([f64; 3], [f64; 3])> = Vec::new();
        if let Some((joints, weights)) = &self.skin {
            for (v, point) in positions.as_chunks::<3>().0.iter().enumerate() {
                for i in v * self.influences..(v + 1) * self.influences {
                    if weights[i] <= 0.0 {
                        continue;
                    }
                    let j = joints[i] as usize;
                    if balls.len() <= j {
                        balls.resize(j + 1, ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]));
                    }
                    let (low, high) = &mut balls[j];
                    extend_aabb(low, high, point.map(f64::from));
                }
            }
        }
        let joints: Vec<f64> = balls
            .iter()
            .flat_map(|(low, high)| match low[0] <= high[0] {
                true => {
                    let centre = centre(*low, *high);
                    [centre[0], centre[1], centre[2], length(sub(*high, centre))]
                }
                false => [0.0; 4],
            })
            .collect();
        let targets: Vec<f64> = (self.targets.iter())
            .map(|t| {
                t.position
                    .chunks(3)
                    .map(|d| d.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>().sqrt())
                    .fold(0.0, f64::max)
            })
            .collect();
        let soft = self.soft_source.is_some();
        let mut reach = serde_json::json!({"joints": if soft { vec![] } else { joints }, "targets": targets, "softVertices": if soft { balls.len() } else { 0 }});
        // The kind the runtime draws by: a cloth is a sheet, seen from both sides.
        if let Some(kind) = self.soft_source {
            reach["softKind"] = serde_json::json!(kind);
        }
        reach
    }
}
