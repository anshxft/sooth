//! Unit tests with the near-sdk mocked VM. The real cross-contract flow is in tests/.
use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::testing_env;

const T0: u64 = 1_793_000_000 * NS_PER_SEC;
const COMMIT_AT: u64 = T0 + 10 * NS_PER_SEC;
const REVEAL_AT: u64 = T0 + 70 * NS_PER_SEC;
const AWARD_AT: u64 = T0 + 130 * NS_PER_SEC;
const SUBMIT_AT: u64 = T0 + 140 * NS_PER_SEC;
const REVIEW_AT: u64 = T0 + 150 * NS_PER_SEC;
const AFTER_REVIEW: u64 = SUBMIT_AT + 61 * NS_PER_SEC;
const AFTER_DELIVERY: u64 = AWARD_AT + 301 * NS_PER_SEC;
const TIMINGS: JobTimings = JobTimings { commit_secs: 60, reveal_secs: 60, delivery_secs: 300, review_secs: 60 };
const WORKER_STORAGE: NearToken = NearToken::from_millinear(50);
const TASK_STORAGE: NearToken = NearToken::from_millinear(50);
const BOND: NearToken = NearToken::from_millinear(500);
const BID_STORAGE: NearToken = NearToken::from_millinear(5);
const JOB_STORAGE: NearToken = NearToken::from_millinear(50);
const DISPUTE: NearToken = NearToken::from_millinear(300);

fn account(name: &str) -> AccountId {
    format!("{name}.testnet").parse().unwrap()
}

fn near(amount: u128) -> NearToken {
    NearToken::from_near(amount)
}

fn milli(amount: u128) -> NearToken {
    NearToken::from_millinear(amount)
}

fn call_at(caller: &AccountId, deposit: NearToken, now: u64) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(account("swarm"))
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .attached_deposit(deposit)
        .block_timestamp(now);
    testing_env!(builder.build());
}

fn hash_of(text: &str) -> String {
    hex_sha256(text)
}

fn new_contract() -> Contract {
    call_at(&account("owner"), ZERO, T0);
    Contract::new(account("owner"), account("sooth"))
}

fn add_worker(c: &mut Contract, name: &str) {
    call_at(&account(name), WORKER_STORAGE.saturating_add(near(3)), T0);
    c.register_worker(name.into());
}

/// Budget 5 NEAR, contractor `gc`.
fn add_task(c: &mut Contract) -> u64 {
    call_at(&account("user"), TASK_STORAGE.saturating_add(near(5)), T0);
    c.create_task(account("gc"), "https://x.co/task.md".into(), hash_of("task"))
}

fn open(c: &mut Contract, task_id: u64, max_price: NearToken) -> u64 {
    call_at(&account("gc"), ZERO, T0);
    c.open_job(task_id, "https://x.co/job.md".into(), hash_of("job"), max_price, TIMINGS)
}

fn bid_hash(job_id: u64, worker: &str, price: NearToken) -> String {
    hash_of(&bid_preimage(job_id, &account(worker), price, 300, "salt"))
}

fn commit(c: &mut Contract, job_id: u64, worker: &str, price: NearToken) {
    call_at(&account(worker), ZERO, COMMIT_AT);
    c.commit_bid(job_id, bid_hash(job_id, worker, price));
}

fn reveal(c: &mut Contract, job_id: u64, worker: &str, price: NearToken) {
    call_at(&account(worker), ZERO, REVEAL_AT);
    c.reveal_bid(job_id, price, 300, "salt".into());
}

/// `worker` wins alone at `price` and delivers; the job is left in review.
fn delivered(c: &mut Contract, task_id: u64, worker: &str, price: NearToken) -> u64 {
    let job_id = open(c, task_id, near(2));
    commit(c, job_id, worker, price);
    reveal(c, job_id, worker, price);
    call_at(&account("anyone"), ZERO, AWARD_AT);
    c.award(job_id);
    call_at(&account(worker), ZERO, SUBMIT_AT);
    c.submit(job_id, "https://x.co/out.md".into(), hash_of("out"));
    job_id
}

/// The dispute reached SOOTH as question 7.
fn disputed(c: &mut Contract, job_id: u64) {
    call_at(&account("gc"), ZERO, REVIEW_AT);
    let _ = c.dispute(job_id);
    call_at(&account("swarm"), ZERO, REVIEW_AT);
    c.on_dispute_created(job_id, Ok(7));
}

fn rule(c: &mut Contract, answer: Answer) {
    call_at(&account("sooth"), ZERO, REVIEW_AT + 600 * NS_PER_SEC);
    c.on_sooth_resolved(7, answer);
}

fn job_of(c: &Contract, id: u64) -> Job {
    c.get_job(id).unwrap().job
}

fn task_of(c: &Contract, id: u64) -> TaskView {
    c.get_task(id).unwrap()
}

fn worker_of(c: &Contract, name: &str) -> WorkerView {
    c.get_worker(account(name)).unwrap()
}

fn free(c: &Contract, name: &str) -> NearToken {
    worker_of(c, name).free_balance
}

fn last_event(name: &str) -> bool {
    get_logs().last().is_some_and(|l| l.contains(&format!(r#""event":"{name}""#)))
}

/// Nothing is created or lost: every yocto paid in is held by a worker, held by the task,
/// or spent on storage and jury fees.
fn assert_conserved(c: &Contract, task_id: u64, workers: &[&str], bids: u128) {
    let task = task_of(c, task_id);
    let deposited = near(5).as_yoctonear() + near(3).as_yoctonear() * workers.len() as u128;
    let held: u128 = workers
        .iter()
        .map(|w| {
            let v = worker_of(c, w);
            v.free_balance.as_yoctonear() + v.locked_balance.as_yoctonear()
        })
        .sum();
    let in_task = task.available.as_yoctonear() + task.task.reserved.as_yoctonear();
    let spent = task.task.costs.as_yoctonear() + BID_STORAGE.as_yoctonear() * bids;
    assert_eq!(held + in_task + spent, deposited, "money was created or lost");
}

// ------------------------------------------------------------------- F20: budget

#[test]
fn deposit_minus_storage_is_the_budget() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    assert_eq!(task_of(&c, task).task.budget, near(5));
    assert_eq!(task_of(&c, task).available, near(5));
}

#[test]
fn open_job_holds_back_price_dispute_and_storage() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    open(&mut c, task, near(2));
    let view = task_of(&c, task);
    assert_eq!(view.task.reserved, near(2).saturating_add(DISPUTE));
    assert_eq!(view.task.costs, JOB_STORAGE);
    assert_eq!(view.available, milli(2_650));
}

#[test]
#[should_panic(expected = "Over budget")]
fn job_above_budget_fails() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    open(&mut c, task, near(5));
}

#[test]
#[should_panic(expected = "Over budget")]
fn jobs_together_cannot_exceed_budget() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    open(&mut c, task, near(2));
    open(&mut c, task, near(3));
}

#[test]
#[should_panic(expected = "Only the contractor can do this")]
fn only_the_contractor_opens_jobs() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    call_at(&account("mallory"), ZERO, T0);
    c.open_job(task, "https://x.co/j".into(), hash_of("j"), near(1), TIMINGS);
}

#[test]
#[should_panic(expected = "Only the task owner can close it")]
fn the_contractor_cannot_take_the_budget() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    call_at(&account("gc"), NearToken::from_yoctonear(1), T0);
    let _ = c.close_task(task);
}

#[test]
#[should_panic(expected = "Task still has active jobs")]
fn a_task_with_active_jobs_cannot_close() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    open(&mut c, task, near(1));
    call_at(&account("user"), NearToken::from_yoctonear(1), T0);
    let _ = c.close_task(task);
}

#[test]
fn close_returns_what_is_left_and_stops_new_jobs() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    call_at(&account("user"), NearToken::from_yoctonear(1), T0);
    let _ = c.close_task(task);
    assert_eq!(task_of(&c, task).task.status, TaskStatus::Closed);
    assert!(last_event("task_closed"));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn closing_needs_a_full_key() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    call_at(&account("user"), ZERO, T0);
    let _ = c.close_task(task);
}

// --------------------------------------------------------------- F21: sealed bids

#[test]
fn commit_locks_the_bond_and_charges_storage() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    commit(&mut c, job, "w1", near(1));
    let w = worker_of(&c, "w1");
    assert_eq!(w.locked_balance, BOND);
    assert_eq!(w.free_balance, near(3).saturating_sub(BOND).saturating_sub(BID_STORAGE));
    assert_eq!(job_of(&c, job).bids[0].price, None, "the price stays sealed");
}

#[test]
#[should_panic(expected = "Hash mismatch")]
fn copying_another_workers_hash_fails() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    add_worker(&mut c, "copycat");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    commit(&mut c, job, "w1", near(1));
    call_at(&account("copycat"), ZERO, COMMIT_AT);
    c.commit_bid(job, bid_hash(job, "w1", near(1)));
    reveal(&mut c, job, "copycat", near(1));
}

#[test]
#[should_panic(expected = "Hash mismatch")]
fn changing_the_price_at_reveal_fails() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    commit(&mut c, job, "w1", near(1));
    reveal(&mut c, job, "w1", milli(900));
}

#[test]
#[should_panic(expected = "Already bid on this job")]
fn one_bid_per_worker() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    commit(&mut c, job, "w1", near(1));
    commit(&mut c, job, "w1", near(1));
}

#[test]
#[should_panic(expected = "Not in bid commit phase")]
fn no_bids_after_commit_closes() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    call_at(&account("w1"), ZERO, REVEAL_AT);
    c.commit_bid(job, bid_hash(job, "w1", near(1)));
}

#[test]
#[should_panic(expected = "Cannot bid on your own job")]
fn the_contractor_cannot_bid() {
    let mut c = new_contract();
    add_worker(&mut c, "gc");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    commit(&mut c, job, "gc", near(1));
}

#[test]
#[should_panic(expected = "Not ready to award")]
fn award_waits_for_reveals_to_close() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    call_at(&account("anyone"), ZERO, REVEAL_AT);
    c.award(job);
}

#[test]
fn cheapest_wins_and_losers_get_their_bond_back() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    add_worker(&mut c, "w2");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    commit(&mut c, job, "w1", near(1));
    commit(&mut c, job, "w2", milli(800));
    reveal(&mut c, job, "w1", near(1));
    reveal(&mut c, job, "w2", milli(800));
    call_at(&account("anyone"), ZERO, AWARD_AT);
    c.award(job);
    let j = job_of(&c, job);
    assert_eq!(j.winner, Some(account("w2")));
    assert_eq!(j.price, Some(milli(800)));
    assert_eq!(worker_of(&c, "w1").locked_balance, ZERO);
    assert_eq!(worker_of(&c, "w2").locked_balance, BOND);
    assert_eq!(task_of(&c, task).task.reserved, milli(800).saturating_add(DISPUTE));
    assert_conserved(&c, task, &["w1", "w2"], 2);
}

#[test]
fn a_bid_above_the_maximum_cannot_win_but_keeps_its_bond() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    add_worker(&mut c, "w2");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(1));
    commit(&mut c, job, "w1", near(2));
    commit(&mut c, job, "w2", near(1));
    reveal(&mut c, job, "w1", near(2));
    reveal(&mut c, job, "w2", near(1));
    call_at(&account("anyone"), ZERO, AWARD_AT);
    c.award(job);
    assert_eq!(job_of(&c, job).winner, Some(account("w2")));
    assert_eq!(worker_of(&c, "w1").locked_balance, ZERO);
    assert_eq!(worker_of(&c, "w1").stats.slashed, ZERO);
}

#[test]
fn a_silent_bidder_loses_the_bond_to_the_task() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    add_worker(&mut c, "ghost");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    commit(&mut c, job, "w1", near(1));
    commit(&mut c, job, "ghost", milli(100));
    reveal(&mut c, job, "w1", near(1));
    call_at(&account("anyone"), ZERO, AWARD_AT);
    c.award(job);
    assert_eq!(job_of(&c, job).winner, Some(account("w1")));
    let ghost = worker_of(&c, "ghost");
    assert_eq!(ghost.locked_balance, ZERO);
    assert_eq!(ghost.stats.no_reveal, 1);
    assert_eq!(task_of(&c, task).task.budget, near(5).saturating_add(BOND));
    assert_conserved(&c, task, &["w1", "ghost"], 2);
}

#[test]
fn no_bids_closes_the_job_and_frees_the_reserve() {
    let mut c = new_contract();
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    call_at(&account("anyone"), ZERO, AWARD_AT);
    c.award(job);
    let j = job_of(&c, job);
    assert_eq!(j.status, JobStatus::Closed);
    assert_eq!(j.result, Some(JobResult::NoBids));
    let view = task_of(&c, task);
    assert_eq!(view.task.reserved, ZERO);
    assert_eq!(view.task.active_jobs, 0);
    assert_eq!(view.available, near(5).saturating_sub(JOB_STORAGE));
}

#[test]
fn delivery_window_is_the_shorter_of_eta_and_limit() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    let hash = hash_of(&bid_preimage(job, &account("w1"), near(1), 9_999, "salt"));
    call_at(&account("w1"), ZERO, COMMIT_AT);
    c.commit_bid(job, hash);
    call_at(&account("w1"), ZERO, REVEAL_AT);
    c.reveal_bid(job, near(1), 9_999, "salt".into());
    call_at(&account("anyone"), ZERO, AWARD_AT);
    c.award(job);
    assert_eq!(job_of(&c, job).delivery_end, Some(U64(AWARD_AT + 300 * NS_PER_SEC)));
}

// --------------------------------------------------------------- F22: delivery

#[test]
fn accepting_pays_the_worker_and_returns_the_bond() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    call_at(&account("gc"), ZERO, REVIEW_AT);
    c.accept(job);
    assert_eq!(job_of(&c, job).result, Some(JobResult::Accepted));
    assert_eq!(free(&c, "w1"), near(4).saturating_sub(BID_STORAGE));
    let w = worker_of(&c, "w1");
    assert_eq!(w.locked_balance, ZERO);
    assert_eq!((w.stats.jobs, w.stats.successful), (1, 1));
    let view = task_of(&c, task);
    assert_eq!(view.task.paid, near(1));
    assert_eq!(view.task.reserved, ZERO);
    assert_eq!(view.available, near(4).saturating_sub(JOB_STORAGE));
    assert!(last_event("job_closed"), "the receipt event");
    assert_conserved(&c, task, &["w1"], 1);
}

#[test]
#[should_panic(expected = "Only the winner can deliver")]
fn only_the_winner_delivers() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    commit(&mut c, job, "w1", near(1));
    reveal(&mut c, job, "w1", near(1));
    call_at(&account("anyone"), ZERO, AWARD_AT);
    c.award(job);
    call_at(&account("mallory"), ZERO, SUBMIT_AT);
    c.submit(job, "https://x.co/o".into(), hash_of("o"));
}

#[test]
#[should_panic(expected = "Only the contractor can do this")]
fn the_worker_cannot_accept_its_own_work() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    call_at(&account("w1"), ZERO, REVIEW_AT);
    c.accept(job);
}

#[test]
#[should_panic(expected = "Not claimable")]
fn no_claim_during_review() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    call_at(&account("w1"), ZERO, REVIEW_AT);
    c.claim(job);
}

#[test]
fn a_silent_contractor_cannot_hold_the_payment() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    call_at(&account("w1"), ZERO, AFTER_REVIEW);
    c.claim(job);
    assert_eq!(job_of(&c, job).result, Some(JobResult::Claimed));
    assert_eq!(free(&c, "w1"), near(4).saturating_sub(BID_STORAGE));
    assert_conserved(&c, task, &["w1"], 1);
}

#[test]
fn missing_delivery_slashes_the_bond_and_frees_the_payment() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    commit(&mut c, job, "w1", near(1));
    reveal(&mut c, job, "w1", near(1));
    call_at(&account("anyone"), ZERO, AWARD_AT);
    c.award(job);
    call_at(&account("anyone"), ZERO, AFTER_DELIVERY);
    c.cancel_job(job);
    assert_eq!(job_of(&c, job).result, Some(JobResult::MissedDelivery));
    let w = worker_of(&c, "w1");
    assert_eq!((w.stats.jobs, w.stats.failed, w.locked_balance), (1, 1, ZERO));
    assert_eq!(task_of(&c, task).task.budget, near(5).saturating_add(BOND));
    assert_conserved(&c, task, &["w1"], 1);
}

#[test]
#[should_panic(expected = "Delivery window still open")]
fn no_cancel_while_delivery_is_open() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = open(&mut c, task, near(2));
    commit(&mut c, job, "w1", near(1));
    reveal(&mut c, job, "w1", near(1));
    call_at(&account("anyone"), ZERO, AWARD_AT);
    c.award(job);
    c.cancel_job(job);
}

// --------------------------------------------------------------- F23: disputes

#[test]
fn dispute_spends_the_held_jury_fee() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    let j = job_of(&c, job);
    assert_eq!(j.status, JobStatus::Disputed);
    assert_eq!(j.question_id, Some(7));
    let view = task_of(&c, task);
    assert_eq!(view.task.costs, JOB_STORAGE.saturating_add(DISPUTE));
    assert_eq!(view.task.reserved, near(1));
    assert_conserved(&c, task, &["w1"], 1);
}

#[test]
fn a_refused_question_returns_the_job_to_review() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    call_at(&account("gc"), ZERO, REVIEW_AT);
    let _ = c.dispute(job);
    call_at(&account("swarm"), ZERO, REVIEW_AT);
    c.on_dispute_created(job, Err(PromiseError::Failed));
    assert_eq!(job_of(&c, job).status, JobStatus::Delivered);
    let view = task_of(&c, task);
    assert_eq!(view.task.costs, JOB_STORAGE);
    assert_eq!(view.task.reserved, near(1).saturating_add(DISPUTE));
}

#[test]
fn ruling_yes_pays_the_worker() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    rule(&mut c, Answer::Yes);
    assert_eq!(job_of(&c, job).result, Some(JobResult::WonDispute));
    assert_eq!(free(&c, "w1"), near(4).saturating_sub(BID_STORAGE));
    assert_eq!(worker_of(&c, "w1").stats.successful, 1);
    assert_conserved(&c, task, &["w1"], 1);
}

#[test]
fn ruling_no_refunds_the_task_and_slashes_the_bond() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    rule(&mut c, Answer::No);
    assert_eq!(job_of(&c, job).result, Some(JobResult::LostDispute));
    let w = worker_of(&c, "w1");
    assert_eq!(w.free_balance, near(3).saturating_sub(BOND).saturating_sub(BID_STORAGE));
    assert_eq!((w.locked_balance, w.stats.failed, w.stats.slashed), (ZERO, 1, BOND));
    let view = task_of(&c, task);
    assert_eq!(view.task.paid, ZERO);
    assert_eq!(view.task.budget, near(5).saturating_add(BOND));
    assert_conserved(&c, task, &["w1"], 1);
}

#[test]
fn ruling_invalid_splits_and_leaves_reputation_alone() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    rule(&mut c, Answer::Invalid);
    assert_eq!(job_of(&c, job).result, Some(JobResult::Split));
    assert_eq!(task_of(&c, task).task.paid, milli(500));
    let w = worker_of(&c, "w1");
    assert_eq!(w.free_balance, milli(3_500).saturating_sub(BID_STORAGE));
    assert_eq!(w.stats.jobs, 0);
    assert_conserved(&c, task, &["w1"], 1);
}

#[test]
fn a_spoofed_ruling_is_ignored() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    call_at(&account("w1"), ZERO, REVIEW_AT);
    c.on_sooth_resolved(7, Answer::Yes);
    assert_eq!(job_of(&c, job).status, JobStatus::Disputed);
}

#[test]
fn a_duplicate_ruling_cannot_pay_twice() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    rule(&mut c, Answer::Yes);
    let balance = free(&c, "w1");
    rule(&mut c, Answer::Yes);
    rule(&mut c, Answer::No);
    assert_eq!(free(&c, "w1"), balance);
    assert_eq!(job_of(&c, job).result, Some(JobResult::WonDispute));
}

#[test]
fn an_unknown_question_is_ignored() {
    let mut c = new_contract();
    call_at(&account("sooth"), ZERO, T0);
    c.on_sooth_resolved(99, Answer::Yes);
}

#[test]
fn settle_applies_the_ruling_if_the_callback_was_lost() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    call_at(&account("swarm"), ZERO, REVIEW_AT);
    c.on_result_read(job, Ok(Some(SoothResult { answer: Answer::No })));
    assert_eq!(job_of(&c, job).result, Some(JobResult::LostDispute));
}

#[test]
fn settle_waits_while_there_is_no_ruling() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    call_at(&account("swarm"), ZERO, REVIEW_AT);
    c.on_result_read(job, Ok(None));
    assert_eq!(job_of(&c, job).status, JobStatus::Disputed);
}

#[test]
fn a_dispute_with_no_ruling_splits_after_the_timeout() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    call_at(&account("swarm"), ZERO, REVIEW_AT + 86_401 * NS_PER_SEC);
    c.on_result_read(job, Ok(None));
    assert_eq!(job_of(&c, job).result, Some(JobResult::Split));
    assert_conserved(&c, task, &["w1"], 1);
}

#[test]
fn a_late_ruling_after_the_timeout_changes_nothing() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    call_at(&account("swarm"), ZERO, REVIEW_AT + 86_401 * NS_PER_SEC);
    c.on_result_read(job, Err(PromiseError::Failed));
    let balance = free(&c, "w1");
    rule(&mut c, Answer::Yes);
    assert_eq!(free(&c, "w1"), balance);
    assert_eq!(job_of(&c, job).result, Some(JobResult::Split));
}

#[test]
fn a_failed_read_before_the_deadline_settles_nothing() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "w1", near(1));
    disputed(&mut c, job);
    call_at(&account("swarm"), ZERO, REVIEW_AT);
    c.on_result_read(job, Err(PromiseError::Failed));
    assert_eq!(job_of(&c, job).status, JobStatus::Disputed);
}

#[test]
fn worst_case_dispute_params_fit_sooth() {
    let mut c = new_contract();
    add_worker(&mut c, "w1");
    let long_uri = format!("https://x.co/{}", "a".repeat(MAX_URI_LEN - 13));
    call_at(&account("user"), near(5), T0);
    let task = c.create_task(account("gc"), long_uri.clone(), hash_of("task"));
    call_at(&account("gc"), ZERO, T0);
    let job = c.open_job(task, long_uri.clone(), hash_of("job"), near(1), TIMINGS);
    commit(&mut c, job, "w1", near(1));
    reveal(&mut c, job, "w1", near(1));
    call_at(&account("anyone"), ZERO, AWARD_AT);
    c.award(job);
    call_at(&account("w1"), ZERO, SUBMIT_AT);
    c.submit(job, long_uri, hash_of("out"));
    let mut j = job_of(&c, job);
    j.id = u64::MAX;
    assert!(dispute_params(&j).len() <= 500, "SOOTH rejects params above 500 chars");
}

#[test]
#[should_panic(expected = "URI must be 1-120 chars")]
fn a_uri_too_long_for_the_jury_fails_early() {
    let mut c = new_contract();
    call_at(&account("user"), near(5), T0);
    c.create_task(account("gc"), "a".repeat(MAX_URI_LEN + 1), hash_of("task"));
}

#[test]
fn a_lost_dispute_keeps_reputation_at_the_floor() {
    let mut c = new_contract();
    add_worker(&mut c, "cheater");
    let task = add_task(&mut c);
    let job = delivered(&mut c, task, "cheater", milli(200));
    disputed(&mut c, job);
    rule(&mut c, Answer::No);
    assert_eq!(worker_of(&c, "cheater").rep_bps, 5_000);
    assert_conserved(&c, task, &["cheater"], 1);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_the_owner_sets_jury_timings() {
    let mut c = new_contract();
    call_at(&account("mallory"), NearToken::from_yoctonear(1), T0);
    c.set_jury_timings(JuryTimings { commit_secs: 30, reveal_secs: 30, challenge_secs: 30 });
}
