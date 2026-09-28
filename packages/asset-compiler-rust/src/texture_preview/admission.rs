//! Texture waves share one job's RAM allowance; completed tails stay charged.
use super::*;
use std::ops::Range;
use std::sync::atomic::AtomicUsize;
mod cost;
#[cfg(test)]
mod tests;

#[derive(Clone, Copy)]
struct Cost {
    working: usize,
    retained: usize,
}
type Outcome = std::result::Result<bake::Baked, (&'static str, usize)>;

fn refused() -> CompilerError {
    CompilerError::new(
        "RAM_ADMISSION_BUDGET_EXCEEDED",
        "Texture working set and retained mip tails exceed the job RAM allowance",
    )
}

/// Reserve every output tail before admitting temporary buffers. No later wave
/// can borrow memory already committed to the final sidecar, even if a codec
/// eventually rejects its lossy tail and returns fewer bytes.
fn waves(costs: &[Cost], budget: usize, workers: usize) -> Result<Vec<Range<usize>>> {
    let retained = costs
        .iter()
        .try_fold(0usize, |sum, c| sum.checked_add(c.retained))
        .ok_or_else(refused)?;
    let available = budget.checked_sub(retained).ok_or_else(refused)?;
    let mut ranges = Vec::new();
    let (mut start, mut used) = (0, 0usize);
    for (index, cost) in costs.iter().enumerate() {
        if cost.working > available {
            return Err(refused());
        }
        if index > start && (index - start >= workers.max(1) || cost.working > available - used) {
            ranges.push(start..index);
            start = index;
            used = 0;
        }
        used += cost.working;
    }
    if start < costs.len() {
        ranges.push(start..costs.len());
    }
    Ok(ranges)
}

fn execute<T: Send>(
    costs: &[Cost],
    budget: usize,
    work: impl Fn(usize) -> Result<T> + Sync,
) -> Result<Vec<T>> {
    let mut results = Vec::with_capacity(costs.len());
    for range in waves(costs, budget, rayon::current_num_threads())? {
        let wave = range
            .into_par_iter()
            .map(&work)
            .collect::<Result<Vec<_>>>()?;
        results.extend(wave);
    }
    Ok(results)
}

pub(super) fn bake(
    inputs: &PreviewInputs<'_>,
    images: &[Value],
    by_image: &BTreeMap<usize, Vec<collect::AtlasTexture>>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Vec<Outcome>> {
    let jobs: Vec<_> = by_image.iter().collect();
    let mut costs = Vec::with_capacity(jobs.len());
    let mut refusals = Vec::with_capacity(jobs.len());
    for (&index, readers) in &jobs {
        check(inputs.o)?;
        let described = images
            .get(index)
            .ok_or("image-out-of-bounds")
            .and_then(|image| {
                source::with_image_bytes(
                    inputs.g,
                    inputs.bin,
                    inputs.image_root,
                    image,
                    |bytes, _| {
                        let driver =
                            crate::plugins::image::by_head(bytes).ok_or("image-format-unknown")?;
                        let (width, height) = driver.dimensions(bytes)?;
                        if width == 0 || height == 0 {
                            return Err("image-empty");
                        }
                        Ok(cost::estimate(
                            width,
                            height,
                            bytes
                                .len()
                                .saturating_add(driver.expanded_payload_bytes(bytes)?),
                            readers.len(),
                            inputs.o.texture_formats.len(),
                        ))
                    },
                )
            });
        match described {
            Ok(cost) => {
                costs.push(cost);
                refusals.push(None);
            }
            Err(reason) => {
                costs.push(Cost {
                    working: 0,
                    retained: 0,
                });
                refusals.push(Some(reason));
            }
        }
    }
    let done = AtomicUsize::new(0);
    execute(&costs, inputs.o.ram_budget_bytes(), |index| {
        check(inputs.o)?;
        let (&image, readers) = jobs[index];
        let outcome = match refusals[index] {
            Some(reason) => Err((reason, readers.len())),
            None => bake::one_image(inputs, images, image, readers),
        };
        let completed = done.fetch_add(1, Ordering::Relaxed) + 1;
        progress(json!({"phase":"textures","completed":completed,"total":jobs.len()}));
        check(inputs.o)?;
        Ok(outcome)
    })
}
