//! L'admission d'un lot : la mémoire que sa concurrence engage vraiment.
//!
//! Un budget d'admission n'est pas une limite de RSS. Il refuse avant de commencer ce qui ne
//! tiendrait manifestement pas, à partir de la taille de la source et de ce qui sera décodé ; il ne
//! borne pas le processus, et la mémoire réellement occupée n'est pas mesurée. Encore faut-il qu'il
//! compte ce qu'il engage : deux ouvriers dotés chacun de la part plancher engageaient deux fois
//! cette part, quel que soit le total annoncé pour le lot.
use crate::Options;

/// La part sous laquelle un travail n'a pas de quoi décoder la plus petite scène.
pub const MIN_JOB_RAM_MB: usize = 64;

/// La concurrence qu'un budget total permet de tenir, et la part qui revient alors à un travail qui
/// n'en réclame pas. Un total sous le plancher d'un seul travail est refusé : rien n'y tiendrait.
pub fn batch_share(workers: usize, ram_total_mb: usize) -> Result<(usize, usize), String> {
    if ram_total_mb < MIN_JOB_RAM_MB {
        return Err(format!(
            "ramBudgetMb {ram_total_mb} is below the {MIN_JOB_RAM_MB} MiB one job needs"
        ));
    }
    let admitted = workers.max(1).min(ram_total_mb / MIN_JOB_RAM_MB);
    Ok((admitted, ram_total_mb / admitted))
}

/// La concurrence que les parts réclamées laissent tenir : les travaux les plus gourmands qui
/// tournent de front doivent entrer ensemble dans le total. Un travail à lui seul plus gourmand que
/// le lot entier est refusé en le nommant — aucune sérialisation ne le fera tenir.
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

    // Comportement : deux ouvriers sous un total de 64 Mio, c'est un ouvrier à 64 Mio. La part ne
    // descend jamais sous le plancher, donc c'est la concurrence qui cède.
    #[test]
    fn deux_parts_plancher_sous_un_total_plancher_donnent_un_seul_ouvrier() {
        assert_eq!(batch_share(2, 64), Ok((1, 64)));
        assert_eq!(batch_share(2, 128), Ok((2, 64)));
        assert_eq!(batch_share(4, 1024), Ok((4, 256)));
    }

    // Comportement : un total qu'un seul travail ne pourrait pas honorer est refusé tout de suite.
    #[test]
    fn un_total_sous_le_plancher_est_refuse() {
        assert!(batch_share(1, 16).is_err());
    }

    // Comportement : des parts réclamées qui ne tiennent pas ensemble réduisent la concurrence.
    #[test]
    fn des_parts_reclamees_trop_larges_reduisent_la_concurrence() {
        let jobs = [job("a", 200), job("b", 200)];
        assert_eq!(fit_workers(2, 256, &jobs), Ok(1));
        assert_eq!(fit_workers(2, 400, &jobs), Ok(2));
    }

    // Comportement : un travail plus gourmand que le lot entier est nommé, et le lot refusé.
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
