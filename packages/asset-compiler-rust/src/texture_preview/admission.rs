//! The textures share one job's RAM allowance (`compiler_budget::admission`); completed tails stay
//! charged.
//!
//! An image whose working set, or the tails retained for the sidecar, exceed that allowance
//! refuses the job (`RAM_ADMISSION_BUDGET_EXCEEDED`): it is never baked at a lower resolution nor
//! replaced by white, either of which would publish less image than the source holds.
use super::*;
use crate::compiler_budget::admission::{alone, run_admitted, Room};
use std::sync::atomic::AtomicUsize;
mod cost;
#[cfg(test)]
mod tests;

#[derive(Clone, Copy)]
struct Cost {
    working: usize,
    retained: usize,
}

/// The cost of an image whose head does not read: it is never decoded.
const NOTHING: Cost = Cost {
    working: 0,
    retained: 0,
};
type Outcome = std::result::Result<bake::Baked, (&'static str, usize)>;

fn refused() -> CompilerError {
    CompilerError::new(
        "RAM_ADMISSION_BUDGET_EXCEEDED",
        "Texture working set and retained mip tails exceed the job RAM allowance",
    )
}

fn remaining_budget(budget: usize, reserved: usize) -> Result<usize> {
    budget.checked_sub(reserved).ok_or_else(refused)
}

/// The room the images' working sets share: what `budget` leaves once every output tail is
/// reserved. No image can borrow memory already committed to the final sidecar, even if a codec
/// eventually rejects its lossy tail and returns fewer bytes; an image wider than that room is
/// refused, never baked alone.
fn admit(costs: &[Cost], budget: usize) -> Result<usize> {
    let retained = costs
        .iter()
        .try_fold(0usize, |sum, c| sum.checked_add(c.retained))
        .ok_or_else(refused)?;
    let room = remaining_budget(budget, retained)?;
    let working: Vec<usize> = costs.iter().map(|c| c.working).collect();
    if working.iter().any(|&bytes| bytes > room) {
        return Err(refused());
    }
    Ok(room)
}

/// The bytes one RGBA8 image `size` texels square holds while it is cooked from its pixels in
/// hand (`bake::cook_decoded`) for `families` block families: its working set and its tails
/// (`cost::estimate`).
pub(crate) fn cook_bytes(size: u32, families: usize) -> usize {
    let pixels = (size as usize)
        .saturating_mul(size as usize)
        .saturating_mul(4);
    let cost = cost::estimate(size, size, pixels, 1, families);
    cost.working.saturating_add(cost.retained)
}

/// `work` over every image of `costs`, as many at once as their working sets fit the room
/// `budget` leaves (`admit`), the results in the images' order.
fn execute<T: Send + Sync>(
    costs: &[Cost],
    budget: usize,
    work: impl Fn(usize) -> Result<T> + Sync,
) -> Result<Vec<T>> {
    let room = admit(costs, budget)?;
    let inputs = alone(costs.len());
    Ok(run_admitted(
        &inputs,
        Room::Fixed(room),
        |i, _| costs[i].working,
        |i, _| work(i),
    )?
    .0)
}

/// The dimensions of an image and its encoded bytes plus what its driver expands them to, read
/// from its head without decoding: what every cost below is estimated from.
fn head(
    (g, bin, image_root): (&Value, &[u8], &Path),
    image: Option<&Value>,
) -> std::result::Result<(u32, u32, usize), &'static str> {
    let image = image.ok_or("image-out-of-bounds")?;
    source::with_image_bytes(g, bin, image_root, image, |bytes, _| {
        let driver = crate::plugins::image::by_head(bytes).ok_or("image-format-unknown")?;
        let (width, height) = driver.dimensions(bytes)?;
        if width == 0 || height == 0 {
            return Err("image-empty");
        }
        let payload = bytes
            .len()
            .saturating_add(driver.expanded_payload_bytes(bytes)?);
        Ok((width, height, payload))
    })
}

/// Decodes `images`, as many at once as the job's allowance less `reserved` admits, `work`
/// measuring each and dropping its pixels: the cutout step's decodes take the same admission as the bake's, and
/// an image too wide for it refuses the job here as it would there. An image whose head does not
/// read costs nothing; `work` names its failure.
pub(crate) fn decode_admitted<T: Send + Sync>(
    o: &Options,
    reserved: usize,
    source: (&Value, &[u8], &Path),
    images: &[usize],
    work: impl Fn(usize) -> T + Sync,
) -> Result<Vec<T>> {
    let declared = source.0.get("images").and_then(Value::as_array);
    let costs: Vec<Cost> = images
        .iter()
        .map(|&index| {
            head(source, declared.and_then(|images| images.get(index)))
                .map_or(NOTHING, |(width, height, payload)| {
                    cost::decoding(width, height, payload)
                })
        })
        .collect();
    execute(
        &costs,
        remaining_budget(o.ram_budget_bytes(), reserved)?,
        |at| {
            check(o)?;
            Ok(work(images[at]))
        },
    )
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
    let source = (inputs.g, inputs.bin, inputs.image_root);
    for (&index, readers) in &jobs {
        check(inputs.o)?;
        let described = head(source, images.get(index)).map(|(width, height, payload)| {
            cost::estimate(
                width,
                height,
                payload,
                readers.len(),
                inputs.o.texture_formats.len(),
            )
        });
        match described {
            Ok(cost) => {
                costs.push(cost);
                refusals.push(None);
            }
            Err(reason) => {
                costs.push(NOTHING);
                refusals.push(Some(reason));
            }
        }
    }
    let done = AtomicUsize::new(0);
    let available = remaining_budget(inputs.o.ram_budget_bytes(), inputs.reserved_bytes)?;
    execute(&costs, available, |index| {
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
