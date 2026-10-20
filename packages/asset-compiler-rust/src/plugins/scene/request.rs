//! What a scene driver receives: the job's source, the files it claims, its cache, its
//! cancellation, its progress report and its RAM budget.
use super::{image_root, PreparedScene};
use crate::Options;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

/// Everything a driver receives to prepare a scene.
pub struct SceneRequest<'a> {
    /// Path given to the compiler: a file or a directory.
    pub source: &'a Path,
    /// Files this driver claims, sorted. A file source carries only one.
    pub inputs: &'a [PathBuf],
    /// Cache where a converted scene is written. Nothing is ever written beside the source.
    pub cache: &'a Path,
    /// Cancellation to check at every bounded-work boundary.
    pub cancelled: &'a AtomicBool,
    /// Named progress report: a driver publishes its steps under its own `phase`.
    pub progress: &'a (dyn Fn(Value) + Sync),
    /// The job's RAM budget in bytes (`ramBudgetMb`): what a driver decodes stays under it.
    pub ram_budget: usize,
}

impl SceneRequest<'_> {
    /// The request of a scene this one carries — an archive's content, a project's model —: its
    /// own source and inputs, the rest of the job's.
    pub(crate) fn nested<'b>(
        &'b self,
        source: &'b Path,
        inputs: &'b [PathBuf],
    ) -> SceneRequest<'b> {
        SceneRequest {
            source,
            inputs,
            ..*self
        }
    }
}

impl<'a> SceneRequest<'a> {
    pub(in crate::plugins) fn new(
        o: &'a Options,
        inputs: &'a [PathBuf],
        progress: &'a (dyn Fn(Value) + Sync),
    ) -> Self {
        Self {
            source: &o.source,
            inputs,
            cache: &o.cache,
            cancelled: &o.cancelled,
            progress,
            ram_budget: o.ram_budget_bytes(),
        }
    }
    /// Scene this driver has just written into `directory`, with the root where the image
    /// URIs it inscribed there resolve: that of the source it read, not that of the cache.
    pub fn converted(&self, directory: PathBuf) -> PreparedScene {
        PreparedScene::converted(directory, &image_root(self.source))
    }
}
