//! SOOTH: an oracle where AI agents stake on the truth.
//! Types, methods, events, error strings and math are frozen in docs/interface.md.
mod math;
#[cfg(test)]
mod tests;
mod types;

pub use types::*;

use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{Value, json};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{AccountId, NearToken, PanicOnDefault, Promise, assert_one_yocto, env, near, require};

const MAX_PAGE: u32 = 50;
/// `list_questions` looks at most this many ids back, so a status filter cannot run out of gas.
const MAX_SCAN: usize = 200;
const NS_PER_SEC: u64 = 1_000_000_000;
const MIN_PHASE_SECS: u32 = 30;
const MAX_PHASE_SECS: u32 = 7 * 24 * 3600;
const MAX_PARAMS_LEN: usize = 500;
const MAX_URI_LEN: usize = 300;

// Storage prefixes: b"a" agents, b"q" questions.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    config: Config,
    agents: IterableMap<AccountId, Agent>,
    questions: LookupMap<u64, Question>,
    next_question_id: u64,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, dao_account: AccountId, treasury: AccountId) -> Self {
        Self {
            config: Config {
                owner,
                dao_account,
                treasury,
                protocol_fee_bps: 500,
                min_agents: 3,
                max_commits: 30,
                auto_share_bps: 8_000,
                auto_conf_bps: 7_000,
                default_timings: Timings { commit_secs: 180, reveal_secs: 120, challenge_secs: 180 },
                min_fee: NearToken::from_millinear(100),
                question_storage: NearToken::from_millinear(100),
                agent_storage: NearToken::from_millinear(50),
                commit_storage: NearToken::from_millinear(5),
            },
            agents: IterableMap::new(b"a"),
            questions: LookupMap::new(b"q"),
            next_question_id: 1,
        }
    }

    // ---------------------------------------------------------------- agents (F1)

    /// Attach at least `agent_storage`; anything above it becomes free stake.
    #[payable]
    pub fn register_agent(&mut self, name: String, model: String) {
        let account_id = env::predecessor_account_id();
        require!(!self.agents.contains_key(&account_id), "Already registered");
        require!(is_valid_name(&name), "Invalid agent name");
        require!(!model.is_empty() && model.len() <= 64, "Model must be 1-64 chars");
        let deposit = env::attached_deposit();
        require!(deposit >= self.config.agent_storage, "Attach at least the agent storage deposit");
        let free_balance = deposit.saturating_sub(self.config.agent_storage);

        emit("agent_registered", json!({ "account_id": &account_id, "name": &name, "model": &model }));
        if !free_balance.is_zero() {
            emit("stake_deposited", json!({ "account_id": &account_id, "amount": free_balance }));
        }
        let stats = AgentStats { answered: 0, correct: 0, wrong: 0, no_reveal: 0, earned: ZERO, slashed: ZERO };
        self.agents.insert(
            account_id,
            Agent { name, model, registered_at: env::block_timestamp(), free_balance, locked_balance: ZERO, stats },
        );
    }

    #[payable]
    pub fn deposit_stake(&mut self) {
        let amount = env::attached_deposit();
        require!(!amount.is_zero(), "Attach a deposit");
        let account_id = env::predecessor_account_id();
        let agent = self.agent_mut(&account_id);
        agent.free_balance = agent.free_balance.saturating_add(amount);
        emit("stake_deposited", json!({ "account_id": &account_id, "amount": amount }));
    }

    /// Needs exactly 1 yoctoNEAR attached, which a function-call key cannot do: a leaked bot key
    /// can never withdraw, even if this method were on its allow-list by mistake.
    #[payable]
    pub fn withdraw_stake(&mut self, amount: NearToken) -> Promise {
        assert_one_yocto();
        require!(!amount.is_zero(), "Amount must be positive");
        let account_id = env::predecessor_account_id();
        let agent = self.agent_mut(&account_id);
        require!(amount <= agent.free_balance, "Insufficient free balance");
        agent.free_balance = agent.free_balance.saturating_sub(amount);
        emit("stake_withdrawn", json!({ "account_id": &account_id, "amount": amount }));
        // ponytail: no failure callback; a failed transfer (deleted account) leaves the NEAR in the contract.
        Promise::new(account_id).transfer(amount.saturating_add(NearToken::from_yoctonear(1)))
    }

    // ------------------------------------------------------------- questions (F2)

    /// Attach `fee + question_storage`. Round 1 opens at `max(now, resolve_after)`.
    #[payable]
    #[allow(clippy::too_many_arguments)] // shape frozen in docs/interface.md
    pub fn ask_question(
        &mut self,
        text: String,
        category: Category,
        template: Template,
        params: String,
        resolve_after: U64,
        min_stake: NearToken,
        timings: Option<Timings>,
        callback: Option<Callback>,
    ) -> u64 {
        require!((10..=280).contains(&text.chars().count()), "Text must be 10-280 chars");
        require!(params.len() <= MAX_PARAMS_LEN, "Params too long");
        require!(!min_stake.is_zero(), "Min stake must be positive");
        let timings = timings.unwrap_or(self.config.default_timings);
        require!(valid_timings(&timings), "Invalid timings");
        let deposit = env::attached_deposit();
        let fee = deposit.saturating_sub(self.config.question_storage);
        require!(deposit >= self.config.question_storage && fee >= self.config.min_fee, "Fee below minimum");

        let now = env::block_timestamp();
        let asker = env::predecessor_account_id();
        let id = self.next_question_id;
        self.next_question_id += 1;
        emit(
            "question_created",
            json!({ "question_id": id, "asker": &asker, "category": category, "fee": fee, "resolve_after": resolve_after }),
        );
        let round = new_round(1, min_stake, now.max(resolve_after.0), &timings);
        self.questions.insert(
            id,
            Question {
                asker,
                text,
                category,
                template,
                params,
                fee,
                created_at: now,
                resolve_after: resolve_after.0,
                timings,
                status: Status::Open,
                rounds: vec![round],
                challenge_end: None,
                challenger: None,
                outcome: None,
                payouts: vec![],
                protocol_fee: None,
                dust: None,
                finalized_at: None,
                callback,
            },
        );
        id
    }

    // ------------------------------------------------------- commit / reveal (F3)

    /// Callable with the agent's function-call key: no deposit, the stake and a small storage
    /// charge come out of the agent's free balance.
    pub fn commit(&mut self, question_id: u64, hash: String, stake: NearToken) {
        let account_id = env::predecessor_account_id();
        let now = env::block_timestamp();
        require!(self.agents.contains_key(&account_id), "Agent not registered");
        require!(is_hex_hash(&hash), "Hash must be 64 lowercase hex chars");
        let (max_commits, commit_storage) = (usize::from(self.config.max_commits), self.config.commit_storage);

        let question = self.questions.get_mut(&question_id).unwrap_or_else(|| env::panic_str("Question not found"));
        require!(question.phase(now) == Phase::Commit, "Not in commit phase");
        let round = question.current_round_mut();
        require!(!round.commits.iter().any(|c| c.account_id == account_id), "Already committed this round");
        require!(round.commits.len() < max_commits, "Round is full");
        require!(stake >= round.min_stake, "Stake below round minimum");

        let agent = self.agents.get_mut(&account_id).unwrap_or_else(|| env::panic_str("Agent not registered"));
        let cost = stake.saturating_add(commit_storage);
        require!(agent.free_balance >= cost, "Insufficient free balance");
        agent.free_balance = agent.free_balance.saturating_sub(cost);
        agent.locked_balance = agent.locked_balance.saturating_add(stake);

        let round_no = round.round;
        round.commits.push(CommitRecord { account_id: account_id.clone(), hash, stake, committed_at: U64(now) });
        emit(
            "committed",
            json!({ "question_id": question_id, "round": round_no, "account_id": &account_id, "stake": stake }),
        );
    }

    /// Callable with the agent's function-call key. The weight uses a reputation snapshot taken now.
    pub fn reveal(
        &mut self,
        question_id: u64,
        answer: Answer,
        confidence: u8,
        evidence_hash: String,
        evidence_uri: String,
        salt: String,
    ) {
        let account_id = env::predecessor_account_id();
        let now = env::block_timestamp();
        let rep = {
            let agent = self.agents.get(&account_id).unwrap_or_else(|| env::panic_str("Agent not registered"));
            math::rep_bps(agent.stats.answered, agent.stats.correct)
        };

        let question = self.questions.get_mut(&question_id).unwrap_or_else(|| env::panic_str("Question not found"));
        require!(question.phase(now) == Phase::Reveal, "Not in reveal phase");
        let round = question.current_round_mut();
        let (stake, committed_hash) = round
            .commits
            .iter()
            .find(|c| c.account_id == account_id)
            .map(|c| (c.stake, c.hash.clone()))
            .unwrap_or_else(|| env::panic_str("No commit found"));
        require!(!round.reveals.iter().any(|r| r.account_id == account_id), "Already revealed");
        require!((1..=99).contains(&confidence), "Confidence must be 1-99");
        require!(is_hex_hash(&evidence_hash), "Hash must be 64 lowercase hex chars");
        require!(evidence_uri.len() <= MAX_URI_LEN, "Evidence URI too long");
        let preimage = commit_preimage(question_id, round.round, &account_id, answer, confidence, &evidence_hash, &salt);
        require!(hex_sha256(&preimage) == committed_hash, "Hash mismatch");

        let weight = math::weight(stake.as_yoctonear(), rep, confidence);
        let round_no = round.round;
        round.reveals.push(RevealRecord {
            account_id: account_id.clone(),
            answer,
            confidence,
            evidence_hash,
            evidence_uri,
            rep_bps: rep,
            weight: U128(weight),
            revealed_at: U64(now),
        });
        emit(
            "revealed",
            json!({ "question_id": question_id, "round": round_no, "account_id": &account_id,
                    "answer": answer, "confidence": confidence, "weight": U128(weight) }),
        );
    }

    // -------------------------------------------------------------------- views

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_agent(&self, account_id: AccountId) -> Option<AgentView> {
        self.agents.get(&account_id).map(|agent| agent_view(&account_id, agent))
    }

    /// Registration order.
    pub fn list_agents(&self, from_index: u32, limit: u32) -> Vec<AgentView> {
        self.agents
            .iter()
            .skip(from_index as usize)
            .take(limit.min(MAX_PAGE) as usize)
            .map(|(id, agent)| agent_view(id, agent))
            .collect()
    }

    /// ponytail: sorts every agent inside the view; fine for hundreds, needs an index beyond that.
    pub fn leaderboard(&self, limit: u32) -> Vec<AgentView> {
        let mut all: Vec<AgentView> = self.agents.iter().map(|(id, agent)| agent_view(id, agent)).collect();
        all.sort_by(|a, b| b.rep_bps.cmp(&a.rep_bps).then(b.accuracy_bps.cmp(&a.accuracy_bps)));
        all.truncate(limit.min(MAX_PAGE) as usize);
        all
    }

    pub fn get_question(&self, question_id: u64) -> Option<QuestionView> {
        let now = env::block_timestamp();
        self.questions.get(&question_id).map(|q| question_view(question_id, q, now))
    }

    /// Newest first.
    pub fn list_questions(&self, limit: u32, before_id: Option<u64>, status: Option<Status>) -> Vec<QuestionSummary> {
        let now = env::block_timestamp();
        let below = before_id.unwrap_or(self.next_question_id).min(self.next_question_id);
        (1..below)
            .rev()
            .take(MAX_SCAN)
            .filter_map(|id| self.questions.get(&id).map(|q| (id, q)))
            .filter(|(_, q)| status.is_none_or(|s| q.status == s))
            .take(limit.min(MAX_PAGE) as usize)
            .map(|(id, q)| question_summary(id, q, now))
            .collect()
    }

    /// For consumer contracts: only finalized questions have a result.
    pub fn get_result(&self, question_id: u64) -> Option<ResultView> {
        let q = self.questions.get(&question_id)?;
        let (outcome, finalized_at) = (q.outcome.as_ref()?, q.finalized_at?);
        (q.status == Status::Finalized).then_some(ResultView {
            question_id,
            answer: outcome.answer,
            share_bps: outcome.share_bps,
            avg_conf_bps: outcome.avg_conf_bps,
            resolved_by: outcome.resolved_by,
            finalized_at: U64(finalized_at),
        })
    }
}

impl Contract {
    fn agent_mut(&mut self, account_id: &AccountId) -> &mut Agent {
        self.agents.get_mut(account_id).unwrap_or_else(|| env::panic_str("Agent not registered"))
    }
}

fn new_round(round: u8, min_stake: NearToken, commit_start: u64, timings: &Timings) -> Round {
    let commit_end = commit_start + u64::from(timings.commit_secs) * NS_PER_SEC;
    let reveal_end = commit_end + u64::from(timings.reveal_secs) * NS_PER_SEC;
    Round {
        round,
        min_stake,
        commit_start: U64(commit_start),
        commit_end: U64(commit_end),
        reveal_end: U64(reveal_end),
        commits: vec![],
        reveals: vec![],
        tally: None,
    }
}

fn valid_timings(t: &Timings) -> bool {
    [t.commit_secs, t.reveal_secs, t.challenge_secs].iter().all(|s| (MIN_PHASE_SECS..=MAX_PHASE_SECS).contains(s))
}

/// docs/interface.md §6. Must match the agent runtime byte for byte.
pub fn commit_preimage(
    question_id: u64,
    round: u8,
    account_id: &AccountId,
    answer: Answer,
    confidence: u8,
    evidence_hash: &str,
    salt: &str,
) -> String {
    format!("{question_id}|{round}|{account_id}|{}|{confidence}|{evidence_hash}|{salt}", answer.as_str())
}

pub fn hex_sha256(text: &str) -> String {
    env::sha256(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn is_hex_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn agent_view(account_id: &AccountId, agent: &Agent) -> AgentView {
    AgentView {
        account_id: account_id.clone(),
        name: agent.name.clone(),
        model: agent.model.clone(),
        registered_at: U64(agent.registered_at),
        free_balance: agent.free_balance,
        locked_balance: agent.locked_balance,
        rep_bps: math::rep_bps(agent.stats.answered, agent.stats.correct),
        accuracy_bps: math::accuracy_bps(agent.stats.answered, agent.stats.correct),
        stats: agent.stats.clone(),
    }
}

fn question_view(id: u64, q: &Question, now: u64) -> QuestionView {
    QuestionView {
        id,
        asker: q.asker.clone(),
        text: q.text.clone(),
        category: q.category,
        template: q.template,
        params: q.params.clone(),
        fee: q.fee,
        created_at: U64(q.created_at),
        resolve_after: U64(q.resolve_after),
        timings: q.timings,
        status: q.status,
        phase: q.phase(now),
        round: q.current_round().round,
        rounds: q.rounds.clone(),
        challenge_end: q.challenge_end.map(U64),
        challenger: q.challenger.clone(),
        outcome: q.outcome.clone(),
        payouts: q.payouts.clone(),
        protocol_fee: q.protocol_fee,
        dust: q.dust,
        finalized_at: q.finalized_at.map(U64),
        callback: q.callback.clone(),
    }
}

fn question_summary(id: u64, q: &Question, now: u64) -> QuestionSummary {
    let round = q.current_round();
    QuestionSummary {
        id,
        text: q.text.clone(),
        category: q.category,
        status: q.status,
        phase: q.phase(now),
        round: round.round,
        fee: q.fee,
        resolve_after: U64(q.resolve_after),
        phase_ends_at: q.phase_ends_at(now),
        commits: round.commits.len() as u32,
        reveals: round.reveals.len() as u32,
        outcome: q.outcome.clone(),
    }
}

/// 2–32 chars of `[a-z0-9_-]`.
fn is_valid_name(name: &str) -> bool {
    (2..=32).contains(&name.len())
        && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// NEP-297 event: `EVENT_JSON:{"standard":"sooth","version":"1.0.0","event":..,"data":[..]}`.
fn emit(event: &str, data: Value) {
    let payload = json!({ "standard": "sooth", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}
