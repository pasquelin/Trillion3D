//! Admission of a batch: the memory its concurrency actually commits.
//!
//! An admission budget is not an RSS limit. It refuses before starting what
//! plainly would not fit, from the source size and what will be decoded; it does
//! not bound the process, and occupied memory is not measured. It still has to
//! count what it commits: two workers each given the floor share used to commit
//! twice that share, whatever total the batch announced.
use crate::Options;

/// Share under which a job has not enough to decode the smallest scene.
pub const MIN_JOB_RAM_MB: usize = 64;

/// Concurrency a total budget can hold, and the share then given to a job that
/// does not request one. A total under a single job's floor is refused: nothing
/// would fit.
pub fn batch_share(workers: usize, ram_total_mb: usize) -> Result<(usize, usize), String> {
    if ram_total_mb < MIN_JOB_RAM_MB {
        return Err(format!(
            "ramBudgetMb {ram_total_mb} is below the {MIN_JOB_RAM_MB} MiB one job needs"
        ));
    }
    let admitted = workers.max(1).min(ram_total_mb / MIN_JOB_RAM_MB);
    Ok((admitted, ram_total_mb / admitted))
}

/// Concurrency that the requested shares leave room for: the greediest jobs that
/// run in parallel must fit together in the total. A job greedier on its own than
/// the whole batch is refused by name — no serialisation will make it fit.
pub fn fit_workers(
    workers: usize,
    ram_total_mb: usize,
    jobs: &[(String, Options)],
) -> Result<usize, String> {
    for (id, options) in jobs {
        if options.ram_budget_mb > ram_total_mb {
            return Err(format!(
                "job {id}: ramBudgetMb {} exceeds the batch ramBudgetMb {ram_total_mb}",
                options.ram_budget_mb
            ));
        }
    }
    let mut wanted: Vec<usize> = jobs.iter().map(|(_, o)| o.ram_budget_mb).collect();
    wanted.sort_unstable_by(|a, b| b.cmp(a));
    let mut admitted = workers.max(1);
    while admitted > 1 && wanted.iter().take(admitted).sum::<usize>() > ram_total_mb {
        admitted -= 1;
    }
    Ok(admitted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicBool, Arc};

    fn job(id: &str, ram_budget_mb: usize) -> (String, Options) {
        let options = Options {
            source: "s".into(),
            cache: "c".into(),
            resource_base: "/assets/".into(),
            scope: "full".into(),
            triangle_budget: 150_000,
            threads: 1,
            ram_budget_mb,
            simplification: "none".into(),
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        (id.to_string(), options)
    }

    // Behaviour: two workers under a 64 MiB total is one worker at 64 MiB. The
    // share never goes below the floor, so it is concurrency that yields.
    #[test]
    fn deux_parts_plancher_sous_un_total_plancher_donnent_un_seul_ouvrier() {
        assert_eq!(batch_share(2, 64), Ok((1, 64)));
        assert_eq!(batch_share(2, 128), Ok((2, 64)));
        assert_eq!(batch_share(4, 1024), Ok((4, 256)));
    }

    // Behaviour: a total that a single job could not honour is refused at once.
    #[test]
    fn un_total_sous_le_plancher_est_refuse() {
        assert!(batch_share(1, 16).is_err());
    }

    // Behaviour: requested shares that do not fit together reduce concurrency.
    #[test]
    fn des_parts_reclamees_trop_larges_reduisent_la_concurrence() {
        let jobs = [job("a", 200), job("b", 200)];
        assert_eq!(fit_workers(2, 256, &jobs), Ok(1));
        assert_eq!(fit_workers(2, 400, &jobs), Ok(2));
    }

    // Behaviour: a job greedier than the whole batch is named, and the batch refused.
    #[test]
    fn un_travail_plus_gourmand_que_le_lot_est_nomme() {
        let jobs = [job("enorme", 4096)];
        let refusal = fit_workers(1, 256, &jobs).expect_err("refus");
        assert!(refusal.contains("enorme"), "{refusal}");
        assert!(
            refusal.contains("4096") && refusal.contains("256"),
            "{refusal}"
        );
    }
}
