//! How far a deformed primitive can move (#357): the rest-pose ball of the vertices each joint
//! moves and each target's largest displacement, which the runtime inflates a cluster's bounds by
//! so that culling never drops a visible deformed cluster.
use super::{Deformation, INFLUENCES};

impl Deformation {
    /// What the runtime inflates a deformed cluster's bounds by (#357): for each joint the ball
    /// of the rest-pose vertices it moves, `[x, y, z, radius]`, and each target's largest
    /// displacement; `null` on a primitive that does not deform.
    pub fn reach(&self, positions: &[f32]) -> serde_json::Value {
        if self.skin.is_none() && self.targets.is_empty() {
            return serde_json::Value::Null;
        }
        let mut balls: Vec<([f64; 3], [f64; 3])> = Vec::new();
        if let Some((joints, weights)) = &self.skin {
            for (v, point) in positions.chunks(3).enumerate() {
                for i in v * INFLUENCES..(v + 1) * INFLUENCES {
                    if weights[i] <= 0.0 {
                        continue;
                    }
                    let j = joints[i] as usize;
                    if balls.len() <= j {
                        balls.resize(j + 1, ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]));
                    }
                    for c in 0..3 {
                        balls[j].0[c] = balls[j].0[c].min(f64::from(point[c]));
                        balls[j].1[c] = balls[j].1[c].max(f64::from(point[c]));
                    }
                }
            }
        }
        let joints: Vec<f64> = balls
            .iter()
            .flat_map(|(low, high)| match low[0] <= high[0] {
                true => {
                    let centre: [f64; 3] = std::array::from_fn(|c| (low[c] + high[c]) / 2.0);
                    let half: f64 = (0..3).map(|c| (high[c] - centre[c]).powi(2)).sum();
                    [centre[0], centre[1], centre[2], half.sqrt()]
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
        serde_json::json!({"joints": if self.soft_source { vec![] } else { joints }, "targets": targets, "softVertices": if self.soft_source { balls.len() } else { 0 }})
    }
}
