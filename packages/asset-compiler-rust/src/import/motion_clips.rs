//! Source-key clips refined against ufbx evaluation for rotation/scale and hierarchy motion.
use super::*;

impl Importer<'_> {
    /// One clip per animation stack of `scene` that moves one of the `written` nodes.
    pub(in crate::import) fn animate(
        &mut self,
        scene: &ufbx::Scene,
        written: &[Written<'_>],
    ) -> Result<()> {
        for stack in scene.anim_stacks.iter() {
            let samples = sampling::sample(scene, stack, written, || self.check())?;
            let times: Vec<f64> = samples.iter().map(|sample| sample.time).collect();
            let mut clip = Clip {
                input: None,
                samplers: Vec::new(),
                channels: Vec::new(),
            };
            for (index, node) in written.iter().enumerate() {
                for (path, rank) in [("translation", 0), ("rotation", 1), ("scale", 2)] {
                    let values: Vec<f32> = samples
                        .iter()
                        .flat_map(|sample| {
                            sample.poses[index].parts[rank].iter().map(|v| *v as f32)
                        })
                        .collect();
                    if node.pose {
                        self.pose_by_parts(node.node);
                        clip.push(self, &times, node.node, path, &values);
                    }
                }
                if !node.channels.is_empty() {
                    let weights: Vec<f32> = samples
                        .iter()
                        .flat_map(|sample| sample.poses[index].weights.iter().copied())
                        .collect();
                    clip.push(self, &times, node.node, "weights", &weights);
                }
            }
            if !clip.channels.is_empty() {
                let name = &*stack.element.name;
                self.animations.push(
                    json!({"name": name, "samplers": clip.samplers, "channels": clip.channels}),
                );
            }
        }
        Ok(())
    }

    /// A node an animation drives carries its pose as translation, rotation and scale.
    fn pose_by_parts(&mut self, node: usize) {
        let Some(matrix) = self.nodes[node]
            .as_object_mut()
            .and_then(|n| n.remove("matrix"))
        else {
            return;
        };
        let m: Vec<f64> = matrix
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_f64)
            .collect();
        let matrix = ufbx::Matrix {
            m00: m[0],
            m10: m[1],
            m20: m[2],
            m01: m[4],
            m11: m[5],
            m21: m[6],
            m02: m[8],
            m12: m[9],
            m22: m[10],
            m03: m[12],
            m13: m[13],
            m23: m[14],
        };
        let [translation, rotation, scale] = trs(&matrix);
        let n = &mut self.nodes[node];
        (n["translation"], n["rotation"], n["scale"]) =
            (json!(translation), json!(rotation), json!(scale));
    }
}

/// A clip being written: its shared key times, its samplers and its channels.
struct Clip {
    input: Option<usize>,
    samplers: Vec<Value>,
    channels: Vec<Value>,
}

impl Clip {
    fn push(
        &mut self,
        importer: &mut Importer<'_>,
        times: &[f64],
        node: usize,
        path: &str,
        values: &[f32],
    ) {
        let input = *self.input.get_or_insert_with(|| {
            let seconds: Vec<f32> = times.iter().map(|t| *t as f32).collect();
            let last = seconds.last().copied().unwrap_or(0.0);
            accessor(
                importer,
                &seconds,
                "SCALAR",
                json!({"min":[0.0],"max":[last]}),
            )
        });
        let kind = match path {
            "translation" | "scale" => "VEC3",
            "rotation" => "VEC4",
            _ => "SCALAR",
        };
        let output = accessor(importer, values, kind, json!({}));
        self.samplers
            .push(json!({"input": input, "output": output, "interpolation": "LINEAR"}));
        let sampler = self.samplers.len() - 1;
        self.channels
            .push(json!({"sampler": sampler, "target": {"node": node, "path": path}}));
    }
}

/// An accessor of `values` of `kind`, with `extra` fields merged in.
fn accessor(importer: &mut Importer<'_>, values: &[f32], kind: &str, mut extra: Value) -> usize {
    let width = match kind {
        "VEC3" => 3,
        "VEC4" => 4,
        _ => 1,
    };
    let view = importer.bin.view(&f32_bytes(values), None);
    extra["bufferView"] = json!(view);
    extra["componentType"] = json!(5126);
    extra["count"] = json!(values.len() / width);
    extra["type"] = json!(kind);
    importer.accessors.push(extra);
    importer.accessors.len() - 1
}
