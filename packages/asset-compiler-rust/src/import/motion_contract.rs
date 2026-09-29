//! Exact FBX animation admission. Flattened world translation and one linear blend target are
//! representable by glTF LINEAR keys. Nonlinear source semantics are refused, never resampled.
use super::*;

fn unsupported(detail: &str) -> CompilerError {
    CompilerError::new("IMPORT_UNSUPPORTED_ANIMATION", detail)
}

pub(in crate::import) fn validate(scene: &ufbx::Scene) -> Result<()> {
    for mesh in &scene.meshes {
        if mesh.skin_deformers.len() > 1
            || mesh
                .skin_deformers
                .iter()
                .any(|skin| skin.skinning_method != ufbx::SkinningMethod::Linear)
        {
            return Err(unsupported("FBX requires a single linear skin deformer"));
        }
        for deformer in &mesh.blend_deformers {
            for channel in &deformer.channels {
                // Expanding intermediate shapes alone would still miss the times their weights
                // cross each shape boundary. Refuse until those breakpoints are represented.
                if channel.keyframes.len() != 1 || channel.keyframes[0].target_weight <= 0.0 {
                    return Err(unsupported(
                        "FBX intermediate or nonpositive blend-shape keys are unsupported",
                    ));
                }
            }
        }
    }
    for stack in &scene.anim_stacks {
        if !stack.time_begin.is_finite()
            || !stack.time_end.is_finite()
            || stack.time_end < stack.time_begin
        {
            return Err(unsupported("FBX animation has an invalid playback span"));
        }
        if !scene.constraints.is_empty() || stack.layers.len() != 1 {
            return Err(unsupported(
                "FBX constrained or layered animation is unsupported",
            ));
        }
        let layer = &stack.layers[0];
        if layer.weight_is_animated {
            return Err(unsupported("FBX animated layer weights are unsupported"));
        }
        for prop in &layer.anim_props {
            for curve in prop.anim_value.curves.iter().flatten() {
                let varying = curve
                    .keyframes
                    .windows(2)
                    .any(|keys| keys[0].value != keys[1].value);
                if curve
                    .keyframes
                    .iter()
                    .take(curve.keyframes.len().saturating_sub(1))
                    .any(|key| key.interpolation != ufbx::Interpolation::Linear)
                    || curve.pre_extrapolation.mode != ufbx::ExtrapolationMode::Constant
                    || curve.post_extrapolation.mode != ufbx::ExtrapolationMode::Constant
                {
                    return Err(unsupported(
                        "FBX nonlinear, stepped or extrapolated animation is unsupported",
                    ));
                }
                if !varying {
                    continue;
                }
                if !matches!(&*prop.prop_name, "Lcl Translation" | "DeformPercent") {
                    return Err(unsupported("FBX animated rotations, scales and other nonlinear properties require source-faithful curve support"));
                }
            }
        }
    }
    Ok(())
}

/// A matrix converted to TRS must differ only by double-precision arithmetic rounding.
pub(super) fn matrix(matrix: &ufbx::Matrix) -> Result<()> {
    let reconstructed = ufbx::transform_to_matrix(&ufbx::matrix_to_transform(matrix));
    let before = matrix_json(matrix);
    let after = matrix_json(&reconstructed);
    let scale = before.iter().fold(1.0_f64, |scale, v| scale.max(v.abs()));
    if before.iter().zip(after).any(|(a, b)| {
        !a.is_finite() || !b.is_finite() || (a - b).abs() > f64::EPSILON * 64.0 * scale
    }) {
        return Err(unsupported(
            "FBX animation world transform contains shear that TRS cannot preserve",
        ));
    }
    Ok(())
}

/// Original keys and both playback endpoints, with no duration cap or uniform resampling.
pub(super) fn times(stack: &ufbx::AnimStack) -> Result<Vec<f64>> {
    let span = stack.time_end - stack.time_begin;
    let mut times = vec![0.0, span];
    for layer in &stack.layers {
        for value in &layer.anim_values {
            for curve in value.curves.iter().flatten() {
                times.extend(
                    curve
                        .keyframes
                        .iter()
                        .map(|key| key.time - stack.time_begin)
                        .filter(|&time| time > 0.0 && time < span),
                );
            }
        }
    }
    checked_times(times)
}

fn checked_times(mut times: Vec<f64>) -> Result<Vec<f64>> {
    times.sort_by(f64::total_cmp);
    times.dedup();
    if times.len() > 36_000
        || times
            .iter()
            .any(|t| !t.is_finite() || !(*t as f32).is_finite())
        || times.windows(2).any(|t| t[0] as f32 >= t[1] as f32)
    {
        return Err(unsupported(
            "FBX animation exceeds key-count or float32 time precision limits",
        ));
    }
    Ok(times)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_spans_and_fast_inbetween_keys_are_preserved() {
        assert_eq!(
            checked_times(vec![0.0, 0.0001, 2400.0]).unwrap(),
            vec![0.0, 0.0001, 2400.0]
        );
        assert!(checked_times((0..36_001).map(f64::from).collect()).is_err());
        assert!(checked_times(vec![1.0, 1.0 + 1e-9]).is_err());
    }
}
