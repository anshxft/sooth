//! SOOTH: an oracle where AI agents stake on the truth.
//! Types, methods, events, error strings and math are frozen in docs/interface.md.
mod math;

use near_sdk::json_types::U64;
use near_sdk::serde_json::{Value, json};
use near_sdk::store::IterableMap;
use near_sdk::{AccountId, NearToken, PanicOnDefault, Promise, assert_one_yocto, env, near, require};

const MAX_PAGE: u32 = 50;
const ZERO: NearToken = NearToken::from_yoctonear(0);

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Timings {
    pub commit_secs: u32,
    pub reveal_secs: u32,
    pub challenge_secs: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Config {
    pub owner: AccountId,
    pub dao_account: AccountId,
    pub treasury: AccountId,
    pub protocol_fee_bps: u16,
    pub min_agents: u8,
    pub max_commits: u8,
    pub auto_share_bps: u16,
    pub auto_conf_bps: u16,
    pub default_timings: Timings,
    pub min_fee: NearToken,
    pub question_storage: NearToken,
    pub agent_storage: NearToken,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct AgentStats {
    pub answered: u32,
    pub correct: u32,
    pub wrong: u32,
    pub no_reveal: u32,
    pub earned: NearToken,
    pub slashed: NearToken,
}

#[near(serializers = [borsh])]
pub struct Agent {
    name: String,
    model: String,
    registered_at: u64,
    free_balance: NearToken,
    locked_balance: NearToken,
    stats: AgentStats,
}

#[near(serializers = [json])]
pub struct AgentView {
    pub account_id: AccountId,
    pub name: String,
    pub model: String,
    pub registered_at: U64,
    pub free_balance: NearToken,
    pub locked_balance: NearToken,
    pub rep_bps: u16,
    pub accuracy_bps: u16,
    pub stats: AgentStats,
}

// Storage prefixes: b"a" agents. (Questions get their own prefixes in F2.)
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    config: Config,
    agents: IterableMap<AccountId, Agent>,
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
            },
            agents: IterableMap::new(b"a"),
        }
    }

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
}

impl Contract {
    fn agent_mut(&mut self, account_id: &AccountId) -> &mut Agent {
        self.agents.get_mut(account_id).unwrap_or_else(|| env::panic_str("Agent not registered"))
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, get_logs};
    use near_sdk::testing_env;

    fn account(name: &str) -> AccountId {
        format!("{name}.testnet").parse().unwrap()
    }

    fn call_as(caller: &AccountId, deposit: NearToken) {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(caller.clone())
            .signer_account_id(caller.clone())
            .attached_deposit(deposit);
        testing_env!(builder.build());
    }

    fn new_contract() -> Contract {
        call_as(&account("owner"), ZERO);
        Contract::new(account("owner"), account("dao"), account("treasury"))
    }

    fn with_agent(deposit: NearToken) -> Contract {
        let mut contract = new_contract();
        call_as(&account("atlas"), deposit);
        contract.register_agent("atlas".into(), "gemini-2.5-flash".into());
        contract
    }

    #[test]
    fn register_keeps_excess_as_free_stake() {
        let contract = with_agent(NearToken::from_millinear(1_050));
        let agent = contract.get_agent(account("atlas")).unwrap();
        assert_eq!(agent.free_balance, NearToken::from_near(1));
        assert_eq!(agent.locked_balance, ZERO);
        assert_eq!(agent.rep_bps, 5_000);
        let logs = get_logs();
        assert!(logs[0].starts_with("EVENT_JSON:") && logs[0].contains(r#""event":"agent_registered""#));
        assert!(logs[1].contains(r#""event":"stake_deposited""#));
    }

    #[test]
    #[should_panic(expected = "Already registered")]
    fn register_twice_fails() {
        let mut contract = with_agent(NearToken::from_millinear(50));
        call_as(&account("atlas"), NearToken::from_millinear(50));
        contract.register_agent("atlas".into(), "gemini".into());
    }

    #[test]
    #[should_panic(expected = "Attach at least the agent storage deposit")]
    fn register_without_storage_fails() {
        with_agent(NearToken::from_millinear(10));
    }

    #[test]
    #[should_panic(expected = "Invalid agent name")]
    fn uppercase_name_fails() {
        let mut contract = new_contract();
        call_as(&account("atlas"), NearToken::from_millinear(50));
        contract.register_agent("Atlas!".into(), "gemini".into());
    }

    #[test]
    fn deposit_then_withdraw_updates_free_balance() {
        let mut contract = with_agent(NearToken::from_millinear(50));
        call_as(&account("atlas"), NearToken::from_near(2));
        contract.deposit_stake();
        call_as(&account("atlas"), NearToken::from_yoctonear(1));
        let _ = contract.withdraw_stake(NearToken::from_millinear(500));
        assert_eq!(contract.get_agent(account("atlas")).unwrap().free_balance, NearToken::from_millinear(1_500));
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn withdraw_without_one_yocto_fails() {
        let mut contract = with_agent(NearToken::from_near(1));
        call_as(&account("atlas"), ZERO);
        let _ = contract.withdraw_stake(NearToken::from_millinear(100));
    }

    #[test]
    #[should_panic(expected = "Insufficient free balance")]
    fn withdraw_more_than_free_fails() {
        let mut contract = with_agent(NearToken::from_near(1));
        call_as(&account("atlas"), NearToken::from_yoctonear(1));
        let _ = contract.withdraw_stake(NearToken::from_near(2));
    }

    #[test]
    #[should_panic(expected = "Agent not registered")]
    fn deposit_by_stranger_fails() {
        let mut contract = new_contract();
        call_as(&account("stranger"), NearToken::from_near(1));
        contract.deposit_stake();
    }

    #[test]
    fn list_agents_pages_in_registration_order() {
        let mut contract = new_contract();
        for name in ["atlas", "nova", "sage"] {
            call_as(&account(name), NearToken::from_millinear(50));
            contract.register_agent(name.into(), "model".into());
        }
        let page = contract.list_agents(1, 10);
        assert_eq!(page.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["nova", "sage"]);
        assert_eq!(contract.leaderboard(2).len(), 2);
    }
}
