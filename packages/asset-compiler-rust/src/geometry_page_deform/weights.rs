use super::{INFLUENCES, WEIGHT_SCALE};

/// Four weights on 255 steps that sum to 255 exactly: each floor, then the steps left to the
/// largest remainders. A vertex whose weights sum to nothing leans wholly on its first joint.
pub fn quantize_weights(weights: [f32; INFLUENCES]) -> [u32; INFLUENCES] {
    let sum: f32 = weights.iter().map(|w| w.max(0.0)).sum();
    if !(sum > 0.0) {
        return [WEIGHT_SCALE, 0, 0, 0];
    }
    let scaled = weights.map(|w| w.max(0.0) / sum * WEIGHT_SCALE as f32);
    let mut out = scaled.map(|w| w.floor() as u32);
    let mut order: [usize; INFLUENCES] = [0, 1, 2, 3];
    order.sort_by(|&a, &b| (scaled[b] - out[b] as f32).total_cmp(&(scaled[a] - out[a] as f32)));
    let left = WEIGHT_SCALE - out.iter().sum::<u32>().min(WEIGHT_SCALE);
    for &j in order.iter().take(left as usize) {
        out[j] += 1;
    }
    out
}
