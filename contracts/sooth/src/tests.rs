//! Unit tests with the near-sdk mocked VM. Sandbox integration tests land with F5.
use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::testing_env;

const T0: u64 = 1_793_000_000 * NS_PER_SEC;
/// Inside the default 180 s commit window that opens at T0.
const COMMIT_AT: u64 = T0 + 10 * NS_PER_SEC;
/// After commit (180 s), inside the 120 s reveal window.
const REVEAL_AT: u64 = T0 + 200 * NS_PER_SEC;
const STORAGE: NearToken = NearToken::from_millinear(50);
const MIN_STAKE: NearToken = NearToken::from_millinear(500);

fn account(name: &str) -> AccountId {
    format!("{name}.testnet").parse().unwrap()
}

fn call_at(caller: &AccountId, deposit: NearToken, now: u64) {
    let mut builder = VMContextBuilder::new();
    builder
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .attached_deposit(deposit)
        .block_timestamp(now);
    testing_env!(builder.build());
}

fn call_as(caller: &AccountId, deposit: NearToken) {
    call_at(caller, deposit, T0);
}

fn new_contract() -> Contract {
    call_as(&account("owner"), ZERO);
    Contract::new(account("owner"), account("dao"), account("treasury"))
}

fn register(c: &mut Contract, id: &AccountId, name: &str, free: NearToken) {
    call_as(id, STORAGE.saturating_add(free));
    c.register_agent(name.into(), "model".into());
}

fn add_agent(c: &mut Contract, name: &str, free: NearToken) {
    register(c, &account(name), name, free);
}

/// Fee 0.2 NEAR (0.3 attached − 0.1 question storage), min stake 0.5 NEAR, default timings.
fn ask(c: &mut Contract, resolve_after: u64) -> u64 {
    call_as(&account("asker"), NearToken::from_millinear(300));
    c.ask_question(
        "Did it rain at least 1 mm in Mumbai on 5 Nov 2026?".into(),
        Category::Weather,
        Template::WeatherRain,
        "{}".into(),
        U64(resolve_after),
        MIN_STAKE,
        None,
        None,
    )
}

fn evidence() -> String {
    hex_sha256("evidence")
}

fn hash_for(qid: u64, id: &AccountId, answer: Answer, confidence: u8, salt: &str) -> String {
    hex_sha256(&commit_preimage(qid, 1, id, answer, confidence, &evidence(), salt))
}

fn commit_as(c: &mut Contract, id: &AccountId, qid: u64, answer: Answer, confidence: u8, stake: NearToken) {
    call_at(id, ZERO, COMMIT_AT);
    c.commit(qid, hash_for(qid, id, answer, confidence, "salt"), stake);
}

fn reveal_as(c: &mut Contract, id: &AccountId, qid: u64, answer: Answer, confidence: u8, salt: &str) {
    call_at(id, ZERO, REVEAL_AT);
    c.reveal(qid, answer, confidence, evidence(), "https://example.com/e.json".into(), salt.into());
}

fn last_event(name: &str) -> bool {
    get_logs().last().is_some_and(|l| l.starts_with("EVENT_JSON:") && l.contains(&format!(r#""event":"{name}""#)))
}

// ------------------------------------------------------------------- F1: agents

#[test]
fn register_keeps_excess_as_free_stake() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(1));
    let agent = c.get_agent(account("atlas")).unwrap();
    assert_eq!(agent.free_balance, NearToken::from_near(1));
    assert_eq!(agent.locked_balance, ZERO);
    assert_eq!(agent.rep_bps, 5_000);
    let logs = get_logs();
    assert!(logs[0].contains(r#""event":"agent_registered""#));
    assert!(logs[1].contains(r#""event":"stake_deposited""#));
}

#[test]
#[should_panic(expected = "Already registered")]
fn register_twice_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", ZERO);
    add_agent(&mut c, "atlas", ZERO);
}

#[test]
#[should_panic(expected = "Attach at least the agent storage deposit")]
fn register_without_storage_fails() {
    let mut c = new_contract();
    call_as(&account("atlas"), NearToken::from_millinear(10));
    c.register_agent("atlas".into(), "model".into());
}

#[test]
#[should_panic(expected = "Invalid agent name")]
fn uppercase_name_fails() {
    let mut c = new_contract();
    register(&mut c, &account("atlas"), "Atlas!", ZERO);
}

#[test]
fn deposit_then_withdraw_updates_free_balance() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", ZERO);
    call_as(&account("atlas"), NearToken::from_near(2));
    c.deposit_stake();
    call_as(&account("atlas"), NearToken::from_yoctonear(1));
    let _ = c.withdraw_stake(NearToken::from_millinear(500));
    assert_eq!(c.get_agent(account("atlas")).unwrap().free_balance, NearToken::from_millinear(1_500));
    assert!(last_event("stake_withdrawn"));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_without_one_yocto_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(1));
    call_as(&account("atlas"), ZERO);
    let _ = c.withdraw_stake(NearToken::from_millinear(100));
}

#[test]
#[should_panic(expected = "Insufficient free balance")]
fn withdraw_more_than_free_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(1));
    call_as(&account("atlas"), NearToken::from_yoctonear(1));
    let _ = c.withdraw_stake(NearToken::from_near(2));
}

#[test]
#[should_panic(expected = "Agent not registered")]
fn deposit_by_stranger_fails() {
    let mut c = new_contract();
    call_as(&account("stranger"), NearToken::from_near(1));
    c.deposit_stake();
}

#[test]
fn list_agents_pages_in_registration_order() {
    let mut c = new_contract();
    for name in ["atlas", "nova", "sage"] {
        add_agent(&mut c, name, ZERO);
    }
    let page = c.list_agents(1, 10);
    assert_eq!(page.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["nova", "sage"]);
    assert_eq!(c.leaderboard(2).len(), 2);
}

// ---------------------------------------------------------------- F2: questions

#[test]
fn ask_question_opens_round_one_now() {
    let mut c = new_contract();
    let qid = ask(&mut c, T0 - NS_PER_SEC);
    assert_eq!(qid, 1);
    assert!(last_event("question_created"));
    let q = c.get_question(qid).unwrap();
    assert_eq!(q.fee, NearToken::from_millinear(200));
    assert_eq!(q.phase, Phase::Commit);
    assert_eq!(q.rounds[0].commit_start.0, T0);
    assert_eq!(q.rounds[0].commit_end.0, T0 + 180 * NS_PER_SEC);
    assert_eq!(q.rounds[0].reveal_end.0, T0 + 300 * NS_PER_SEC);
}

#[test]
fn future_event_is_scheduled_until_resolve_after() {
    let mut c = new_contract();
    let later = T0 + 3_600 * NS_PER_SEC;
    let qid = ask(&mut c, later);
    let summary = &c.list_questions(10, None, None)[0];
    assert_eq!(summary.id, qid);
    assert_eq!(summary.phase, Phase::Scheduled);
    assert_eq!(summary.phase_ends_at, Some(U64(later)));
}

#[test]
fn phases_follow_block_time() {
    let mut c = new_contract();
    let qid = ask(&mut c, T0);
    for (now, phase) in [(COMMIT_AT, Phase::Commit), (REVEAL_AT, Phase::Reveal), (T0 + 301 * NS_PER_SEC, Phase::AwaitingTally)] {
        call_at(&account("viewer"), ZERO, now);
        assert_eq!(c.get_question(qid).unwrap().phase, phase);
    }
}

#[test]
#[should_panic(expected = "Fee below minimum")]
fn fee_below_minimum_fails() {
    let mut c = new_contract();
    call_as(&account("asker"), NearToken::from_millinear(150));
    c.ask_question("A long enough question?".into(), Category::News, Template::FreeText, "{}".into(), U64(T0), MIN_STAKE, None, None);
}

#[test]
#[should_panic(expected = "Text must be 10-280 chars")]
fn short_text_fails() {
    let mut c = new_contract();
    call_as(&account("asker"), NearToken::from_millinear(300));
    c.ask_question("Rain?".into(), Category::Weather, Template::FreeText, "{}".into(), U64(T0), MIN_STAKE, None, None);
}

#[test]
#[should_panic(expected = "Invalid timings")]
fn tiny_timings_fail() {
    let mut c = new_contract();
    call_as(&account("asker"), NearToken::from_millinear(300));
    let timings = Timings { commit_secs: 5, reveal_secs: 120, challenge_secs: 180 };
    c.ask_question("A long enough question?".into(), Category::News, Template::FreeText, "{}".into(), U64(T0), MIN_STAKE, Some(timings), None);
}

#[test]
fn list_questions_is_newest_first_and_filters() {
    let mut c = new_contract();
    for _ in 0..3 {
        ask(&mut c, T0);
    }
    let ids = |v: Vec<QuestionSummary>| v.iter().map(|q| q.id).collect::<Vec<_>>();
    assert_eq!(ids(c.list_questions(10, None, None)), [3, 2, 1]);
    assert_eq!(ids(c.list_questions(10, Some(3), None)), [2, 1]);
    assert_eq!(ids(c.list_questions(1, None, Some(Status::Open))), [3]);
    assert!(c.list_questions(10, None, Some(Status::Finalized)).is_empty());
    assert!(c.get_result(1).is_none());
}

// --------------------------------------------------------- F3: commit / reveal

#[test]
fn commit_locks_stake_and_charges_storage() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, NearToken::from_near(1));
    assert!(last_event("committed"));
    let agent = c.get_agent(account("atlas")).unwrap();
    assert_eq!(agent.locked_balance, NearToken::from_near(1));
    assert_eq!(agent.free_balance, NearToken::from_millinear(995)); // 2 − 1 stake − 0.005 storage
    assert_eq!(c.get_question(qid).unwrap().rounds[0].commits.len(), 1);
}

#[test]
#[should_panic(expected = "Not in commit phase")]
fn commit_after_window_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    call_at(&account("atlas"), ZERO, REVEAL_AT);
    c.commit(qid, hash_for(qid, &account("atlas"), Answer::Yes, 88, "salt"), NearToken::from_near(1));
}

#[test]
#[should_panic(expected = "Already committed this round")]
fn commit_twice_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(3));
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, NearToken::from_near(1));
    commit_as(&mut c, &account("atlas"), qid, Answer::No, 60, NearToken::from_near(1));
}

#[test]
#[should_panic(expected = "Stake below round minimum")]
fn stake_below_minimum_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, NearToken::from_millinear(100));
}

#[test]
#[should_panic(expected = "Insufficient free balance")]
fn commit_needs_stake_plus_storage() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", MIN_STAKE); // exactly the stake, nothing for storage
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, MIN_STAKE);
}

#[test]
#[should_panic(expected = "Hash must be 64 lowercase hex chars")]
fn malformed_hash_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    call_at(&account("atlas"), ZERO, COMMIT_AT);
    c.commit(qid, "NOT-A-HASH".into(), NearToken::from_near(1));
}

#[test]
fn reveal_stores_weight_with_rep_snapshot() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, NearToken::from_near(1));
    reveal_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, "salt");
    assert!(last_event("revealed"));
    let reveal = c.get_question(qid).unwrap().rounds[0].reveals[0].clone();
    assert_eq!(reveal.answer, Answer::Yes);
    assert_eq!(reveal.rep_bps, 5_000); // new agent
    assert_eq!(reveal.weight.0, 440_000_000_000_000_000_000_000); // 1 NEAR × 0.5 × 0.88
}

#[test]
#[should_panic(expected = "Hash mismatch")]
fn wrong_salt_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, NearToken::from_near(1));
    reveal_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, "guess");
}

#[test]
#[should_panic(expected = "Hash mismatch")]
fn changed_answer_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, NearToken::from_near(1));
    reveal_as(&mut c, &account("atlas"), qid, Answer::No, 88, "salt");
}

#[test]
#[should_panic(expected = "Hash mismatch")]
fn copied_hash_cannot_be_revealed_by_another_agent() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    add_agent(&mut c, "bob", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, NearToken::from_near(1));
    // Bob copies atlas's public hash, then replays atlas's revealed answer and salt.
    let copied = hash_for(qid, &account("atlas"), Answer::Yes, 88, "salt");
    call_at(&account("bob"), ZERO, COMMIT_AT);
    c.commit(qid, copied, NearToken::from_near(1));
    reveal_as(&mut c, &account("bob"), qid, Answer::Yes, 88, "salt");
}

#[test]
#[should_panic(expected = "Not in reveal phase")]
fn reveal_during_commit_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, NearToken::from_near(1));
    call_at(&account("atlas"), ZERO, COMMIT_AT);
    c.reveal(qid, Answer::Yes, 88, evidence(), "https://example.com/e.json".into(), "salt".into());
}

#[test]
#[should_panic(expected = "No commit found")]
fn reveal_without_commit_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    reveal_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, "salt");
}

#[test]
#[should_panic(expected = "Already revealed")]
fn reveal_twice_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, NearToken::from_near(1));
    reveal_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, "salt");
    reveal_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, "salt");
}

#[test]
#[should_panic(expected = "Confidence must be 1-99")]
fn confidence_100_fails() {
    let mut c = new_contract();
    add_agent(&mut c, "atlas", NearToken::from_near(2));
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 100, NearToken::from_near(1));
    reveal_as(&mut c, &account("atlas"), qid, Answer::Yes, 100, "salt");
}

// --------------------------------------------------------------------- F4: tally

/// Reveal window of round 1 closes at T0 + 300 s.
const TALLY_AT: u64 = T0 + 301 * NS_PER_SEC;

fn vote(c: &mut Contract, qid: u64, round: u8, opens_at: u64, votes: &[(&str, Answer, u8)]) {
    for (name, answer, conf) in votes {
        let id = account(name);
        call_at(&id, ZERO, opens_at + 10 * NS_PER_SEC);
        let hash = hex_sha256(&commit_preimage(qid, round, &id, *answer, *conf, &evidence(), "salt"));
        c.commit(qid, hash, MIN_STAKE.saturating_mul(u128::from(round)));
    }
    for (name, answer, conf) in votes {
        call_at(&account(name), ZERO, opens_at + 200 * NS_PER_SEC);
        c.reveal(qid, *answer, *conf, evidence(), "https://example.com/e.json".into(), "salt".into());
    }
}

fn tally_at(c: &mut Contract, qid: u64, now: u64) -> QuestionView {
    call_at(&account("cranker"), ZERO, now);
    c.tally(qid);
    c.get_question(qid).unwrap()
}

fn agents(c: &mut Contract, names: &[&str]) {
    for name in names {
        add_agent(c, name, NearToken::from_near(5));
    }
}

#[test]
fn agreement_becomes_provisional_with_a_challenge_window() {
    let mut c = new_contract();
    agents(&mut c, &["atlas", "nova", "sage"]);
    let qid = ask(&mut c, T0);
    vote(&mut c, qid, 1, T0, &[("atlas", Answer::Yes, 88), ("nova", Answer::Yes, 91), ("sage", Answer::Yes, 84)]);
    let q = tally_at(&mut c, qid, TALLY_AT);
    assert!(last_event("tallied"));
    assert_eq!(q.status, Status::Provisional);
    assert_eq!(q.phase, Phase::Challenge);
    assert_eq!(q.challenge_end, Some(U64(TALLY_AT + 180 * NS_PER_SEC)));
    let t = q.rounds[0].tally.clone().unwrap();
    assert!(t.confident && t.winner == Some(Answer::Yes) && t.share_bps == 10_000);
}

#[test]
fn split_vote_opens_round_two_with_double_stake() {
    let mut c = new_contract();
    agents(&mut c, &["atlas", "nova", "sage"]);
    let qid = ask(&mut c, T0);
    vote(&mut c, qid, 1, T0, &[("atlas", Answer::Yes, 80), ("nova", Answer::No, 80), ("sage", Answer::Yes, 60)]);
    let q = tally_at(&mut c, qid, TALLY_AT);
    assert_eq!(q.status, Status::Open);
    assert_eq!(q.round, 2);
    assert_eq!(q.phase, Phase::Commit);
    assert_eq!(q.rounds[1].min_stake, MIN_STAKE.saturating_mul(2));
    assert_eq!(q.rounds[1].commit_start, U64(TALLY_AT));
    assert!(!q.rounds[0].tally.clone().unwrap().confident);
}

#[test]
fn two_agreeing_agents_are_not_enough() {
    let mut c = new_contract();
    agents(&mut c, &["atlas", "nova"]);
    let qid = ask(&mut c, T0);
    vote(&mut c, qid, 1, T0, &[("atlas", Answer::Yes, 95), ("nova", Answer::Yes, 95)]);
    assert_eq!(tally_at(&mut c, qid, TALLY_AT).round, 2);
}

#[test]
fn split_round_two_escalates_to_the_dao() {
    let mut c = new_contract();
    agents(&mut c, &["atlas", "nova", "sage"]);
    let qid = ask(&mut c, T0);
    let split = [("atlas", Answer::Yes, 80), ("nova", Answer::No, 80), ("sage", Answer::Yes, 60)];
    vote(&mut c, qid, 1, T0, &split);
    tally_at(&mut c, qid, TALLY_AT);
    vote(&mut c, qid, 2, TALLY_AT, &split);
    let q = tally_at(&mut c, qid, TALLY_AT + 301 * NS_PER_SEC);
    assert_eq!(q.status, Status::Escalated);
    assert_eq!(q.phase, Phase::Dao);
}

#[test]
fn nobody_revealing_refunds_the_asker_and_slashes_silent_agents() {
    let mut c = new_contract();
    agents(&mut c, &["atlas"]);
    let qid = ask(&mut c, T0);
    commit_as(&mut c, &account("atlas"), qid, Answer::Yes, 88, MIN_STAKE);
    let q = tally_at(&mut c, qid, TALLY_AT);
    assert_eq!(q.status, Status::Refunded);
    assert_eq!(q.payouts.len(), 1);
    assert_eq!(q.payouts[0].reason, PayoutReason::NoReveal);
    assert_eq!(q.payouts[0].delta.0, -(MIN_STAKE.as_yoctonear() as i128));
    let atlas = c.get_agent(account("atlas")).unwrap();
    assert_eq!(atlas.locked_balance, ZERO);
    assert_eq!(atlas.stats.no_reveal, 1);
    assert_eq!(atlas.stats.slashed, MIN_STAKE);
    // 5 NEAR − 0.5 stake (slashed) − 0.005 commit storage
    assert_eq!(atlas.free_balance, NearToken::from_millinear(4_495));
}

#[test]
#[should_panic(expected = "Not ready to tally")]
fn tally_before_reveal_closes_fails() {
    let mut c = new_contract();
    let qid = ask(&mut c, T0);
    tally_at(&mut c, qid, REVEAL_AT);
}

// ------------------------------------------------------------------ F5: finalize

/// Challenge window (180 s) after a tally at TALLY_AT.
const FINALIZE_AT: u64 = TALLY_AT + 181 * NS_PER_SEC;

fn finalize_at(c: &mut Contract, qid: u64, now: u64) -> QuestionView {
    call_at(&account("cranker"), ZERO, now);
    c.finalize(qid);
    c.get_question(qid).unwrap()
}

/// 3 honest agents say YES; mallory says NO at 60 % (weight share for YES ≈ 81 %, so it auto-resolves).
fn settled_question(c: &mut Contract) -> u64 {
    agents(c, &["atlas", "nova", "sage", "mallory"]);
    let qid = ask(c, T0);
    vote(c, qid, 1, T0, &[("atlas", Answer::Yes, 90), ("nova", Answer::Yes, 85), ("sage", Answer::Yes, 80), ("mallory", Answer::No, 60)]);
    assert_eq!(tally_at(c, qid, TALLY_AT).status, Status::Provisional);
    qid
}

#[test]
fn finalize_rewards_the_right_and_slashes_the_liar() {
    let mut c = new_contract();
    let qid = settled_question(&mut c);
    let q = finalize_at(&mut c, qid, FINALIZE_AT);
    assert!(last_event("finalized"));
    assert_eq!(q.status, Status::Finalized);
    let outcome = q.outcome.clone().unwrap();
    assert_eq!((outcome.answer, outcome.resolved_by), (Answer::Yes, ResolvedBy::Auto));
    assert_eq!(c.get_result(qid).unwrap().answer, Answer::Yes);

    let mallory = c.get_agent(account("mallory")).unwrap();
    assert_eq!(mallory.locked_balance, ZERO);
    assert_eq!(mallory.stats.wrong, 1);
    assert_eq!(mallory.stats.slashed, NearToken::from_millinear(300)); // 0.5 stake × 60 %
    assert_eq!(mallory.free_balance, NearToken::from_millinear(4_695)); // 5 − 0.5 − 0.005 + 0.2 back

    // Money in = money out: fee + slashes = protocol fee + rewards + dust.
    let earned: u128 = ["atlas", "nova", "sage"].iter().map(|n| c.get_agent(account(n)).unwrap().stats.earned.as_yoctonear()).sum();
    let fee = q.fee.as_yoctonear();
    assert_eq!(
        fee + mallory.stats.slashed.as_yoctonear(),
        q.protocol_fee.unwrap().as_yoctonear() + earned + q.dust.unwrap().as_yoctonear()
    );
    let atlas = c.get_agent(account("atlas")).unwrap();
    assert!(atlas.stats.earned > ZERO && atlas.stats.correct == 1 && atlas.locked_balance == ZERO);
}

#[test]
#[should_panic(expected = "Not ready to finalize")]
fn finalize_during_challenge_window_fails() {
    let mut c = new_contract();
    let qid = settled_question(&mut c);
    finalize_at(&mut c, qid, TALLY_AT + 10 * NS_PER_SEC);
}

fn escalated_question(c: &mut Contract) -> u64 {
    agents(c, &["atlas", "nova", "sage"]);
    let qid = ask(c, T0);
    let split = [("atlas", Answer::Yes, 80), ("nova", Answer::No, 80), ("sage", Answer::Yes, 60)];
    vote(c, qid, 1, T0, &split);
    tally_at(c, qid, TALLY_AT);
    vote(c, qid, 2, TALLY_AT, &split);
    assert_eq!(tally_at(c, qid, TALLY_AT + 301 * NS_PER_SEC).status, Status::Escalated);
    qid
}

#[test]
fn dao_resolves_an_escalated_question() {
    let mut c = new_contract();
    let qid = escalated_question(&mut c);
    call_at(&account("dao"), ZERO, TALLY_AT + 400 * NS_PER_SEC);
    c.dao_resolve(qid, Answer::No);
    let q = c.get_question(qid).unwrap();
    assert_eq!(q.status, Status::Finalized);
    assert_eq!(q.outcome.unwrap().resolved_by, ResolvedBy::Dao);
    assert_eq!(q.payouts.len(), 6); // 3 agents × 2 rounds, each settled on its own
    assert_eq!(c.get_agent(account("nova")).unwrap().stats.correct, 2);
}

#[test]
#[should_panic(expected = "Only the DAO can resolve")]
fn only_the_dao_can_resolve() {
    let mut c = new_contract();
    let qid = escalated_question(&mut c);
    call_at(&account("atlas"), ZERO, TALLY_AT + 400 * NS_PER_SEC);
    c.dao_resolve(qid, Answer::Yes);
}

#[test]
#[should_panic(expected = "Question is not escalated")]
fn dao_cannot_override_an_agent_verdict() {
    let mut c = new_contract();
    let qid = settled_question(&mut c);
    call_at(&account("dao"), ZERO, FINALIZE_AT);
    c.dao_resolve(qid, Answer::No);
}

#[test]
fn hex_sha256_is_standard_sha256() {
    assert_eq!(hex_sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

/// Worst case: 30 long account ids, each commits and reveals with a 300-char evidence URI.
/// The bytes written must be paid for by question_storage + 30 × commit_storage.
#[test]
fn full_round_fits_the_storage_budget() {
    let mut c = new_contract();
    let ids: Vec<AccountId> = (0..30).map(|i| format!("a{i:02}{}.testnet", "x".repeat(45)).parse().unwrap()).collect();
    for (i, id) in ids.iter().enumerate() {
        register(&mut c, id, &format!("a{i:02}"), NearToken::from_near(1));
    }
    c.agents.flush();

    call_as(&account("asker"), NearToken::from_millinear(300));
    let qid = c.ask_question("x".repeat(280), Category::News, Template::FreeText, "p".repeat(500), U64(T0), MIN_STAKE, None, None);
    let uri = format!("https://example.com/{}", "u".repeat(280));
    for id in &ids {
        call_at(id, ZERO, COMMIT_AT);
        c.commit(qid, hex_sha256(&commit_preimage(qid, 1, id, Answer::Yes, 90, &evidence(), "salt")), MIN_STAKE);
    }
    for id in &ids {
        call_at(id, ZERO, REVEAL_AT);
        c.reveal(qid, Answer::Yes, 90, evidence(), uri.clone(), "salt".into());
    }
    // Collections only write on flush, and every testing_env! resets the usage counter, so
    // measure inside the last context: the flush writes the whole question at once.
    let before = env::storage_usage();
    c.questions.flush();
    c.agents.flush();
    let bytes = env::storage_usage() - before;
    assert!(bytes > 10_000, "measured {bytes} bytes; the flush did not write the question");
    let cost = env::storage_byte_cost().saturating_mul(u128::from(bytes));
    let budget = NearToken::from_millinear(100).saturating_add(NearToken::from_millinear(5).saturating_mul(30));
    eprintln!("worst-case round: {bytes} bytes = {cost} (budget {budget})");
    assert!(cost <= budget, "{bytes} bytes cost {cost} > budget {budget}");
}
