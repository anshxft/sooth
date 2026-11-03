//! End to end on a local sandbox with both real wasms: a contractor that only holds a function-call
//! key hires a cheater, the SOOTH jury rules against the work, and SOOTH's callback settles the job.
//! Then the job is bought again from an honest worker, inside the same budget.
use cargo_near_build::BuildOpts;
use near_api::signer::generate_secret_key;
use near_api::types::transaction::actions::{AccessKeyPermission, FunctionCallPermission};
use near_api::{Account, AccountId, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;
use swarm::{bid_preimage, hex_sha256};

const EVIDENCE: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const URI: &str = "https://example.com/doc.md";
const QID: u64 = 1;
const ZERO: NearToken = NearToken::from_yoctonear(0);

struct Env {
    sandbox: near_sandbox::Sandbox,
    net: NetworkConfig,
    key: Arc<Signer>,
    swarm: near_api::Contract,
    sooth: near_api::Contract,
}

impl Env {
    async fn call(&self, contract: &near_api::Contract, signer: &AccountId, method: &str, args: Value, deposit: NearToken) -> testresult::TestResult<()> {
        self.call_with(contract, signer, self.key.clone(), method, args, deposit).await
    }

    async fn call_with(
        &self,
        contract: &near_api::Contract,
        signer: &AccountId,
        key: Arc<Signer>,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> testresult::TestResult<()> {
        contract
            .call_function(method, args)
            .transaction()
            .deposit(deposit)
            .with_signer(signer.clone(), key)
            .send_to(&self.net)
            .await?
            .assert_success();
        Ok(())
    }

    async fn job(&self, job_id: u64) -> testresult::TestResult<Value> {
        Ok(self.swarm.call_function("get_job", json!({ "job_id": job_id })).read_only().fetch_from(&self.net).await?.data)
    }

    async fn question(&self) -> testresult::TestResult<Value> {
        Ok(self.sooth.call_function("get_question", json!({ "question_id": QID })).read_only().fetch_from(&self.net).await?.data)
    }

    async fn wait_job(&self, job_id: u64, phase: &str) -> testresult::TestResult<()> {
        for _ in 0..120 {
            if self.job(job_id).await?["phase"] == phase {
                return Ok(());
            }
            self.sandbox.fast_forward(5).await?;
        }
        panic!("job {job_id} never reached phase {phase}");
    }

    async fn wait_question(&self, phase: &str) -> testresult::TestResult<()> {
        for _ in 0..120 {
            if self.question().await?["phase"] == phase {
                return Ok(());
            }
            self.sandbox.fast_forward(5).await?;
        }
        panic!("question never reached phase {phase}");
    }

    /// One worker bids alone, wins, and delivers; the job is left in review.
    async fn win_and_deliver(&self, job_id: u64, worker: &AccountId, price: NearToken) -> testresult::TestResult<()> {
        let sdk_id: near_sdk::AccountId = worker.as_str().parse()?;
        let hash = hex_sha256(&bid_preimage(job_id, &sdk_id, price, 300, "salt"));
        self.call(&self.swarm, worker, "commit_bid", json!({ "job_id": job_id, "hash": hash }), ZERO).await?;
        self.wait_job(job_id, "BidReveal").await?;
        self.call(&self.swarm, worker, "reveal_bid", json!({ "job_id": job_id, "price": price, "eta_secs": 300, "salt": "salt" }), ZERO).await?;
        self.wait_job(job_id, "AwaitingAward").await?;
        self.call(&self.swarm, worker, "award", json!({ "job_id": job_id }), ZERO).await?;
        assert_eq!(self.job(job_id).await?["phase"], "Delivering");
        self.call(&self.swarm, worker, "submit", json!({ "job_id": job_id, "deliverable_uri": URI, "deliverable_hash": EVIDENCE }), ZERO).await?;
        Ok(())
    }
}

#[tokio::test]
async fn a_bad_delivery_loses_to_the_jury_and_the_job_is_bought_again() -> testresult::TestResult<()> {
    let swarm_wasm = std::fs::read(cargo_near_build::build_with_cli(BuildOpts::default())?)?;
    let sooth_opts = BuildOpts { manifest_path: Some("../sooth/Cargo.toml".into()), ..Default::default() };
    let sooth_wasm = std::fs::read(cargo_near_build::build_with_cli(sooth_opts)?)?;

    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let key = Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse().unwrap())?;

    let sooth_id = create(&sandbox, "sooth.sandbox").await?;
    let swarm_id = create(&sandbox, "swarm.sandbox").await?;
    let treasury = create(&sandbox, "treasury.sandbox").await?;
    let user = create(&sandbox, "user.sandbox").await?;
    let contractor = create(&sandbox, "contractor.sandbox").await?;
    let cheater = create(&sandbox, "cheater.sandbox").await?;
    let honest = create(&sandbox, "honest.sandbox").await?;

    near_api::Contract::deploy(sooth_id.clone())
        .use_code(sooth_wasm)
        .with_init_call("new", json!({ "owner": sooth_id, "dao_account": sooth_id, "treasury": treasury }))?
        .with_signer(key.clone())
        .send_to(&net)
        .await?
        .assert_success();
    near_api::Contract::deploy(swarm_id.clone())
        .use_code(swarm_wasm)
        .with_init_call("new", json!({ "owner": swarm_id, "sooth": sooth_id }))?
        .with_signer(key.clone())
        .send_to(&net)
        .await?
        .assert_success();

    let env = Env {
        sandbox,
        net,
        key: key.clone(),
        swarm: Account(swarm_id.clone()).as_contract(),
        sooth: Account(sooth_id.clone()).as_contract(),
    };

    env.call(&env.swarm, &swarm_id, "set_jury_timings", json!({ "timings": { "commit_secs": 30, "reveal_secs": 30, "challenge_secs": 30 } }), NearToken::from_yoctonear(1)).await?;
    for (id, name) in [(&cheater, "cheater"), (&honest, "honest")] {
        env.call(&env.swarm, id, "register_worker", json!({ "name": name }), NearToken::from_near(2)).await?;
    }

    // The contractor can spend only through these methods, and cannot attach a deposit.
    let bot_secret = generate_secret_key()?;
    Account(contractor.clone())
        .add_key(
            AccessKeyPermission::FunctionCall(FunctionCallPermission {
                allowance: Some(NearToken::from_millinear(250)),
                receiver_id: swarm_id.to_string(),
                method_names: vec!["open_job".into(), "accept".into(), "dispute".into()],
            }),
            bot_secret.public_key(),
        )
        .with_signer(key.clone())
        .send_to(&env.net)
        .await?
        .assert_success();
    let bot = Signer::from_secret_key(bot_secret)?;

    env.call(&env.swarm, &user, "create_task", json!({ "contractor": contractor, "brief_uri": URI, "brief_hash": EVIDENCE }), NearToken::from_millinear(5_050)).await?;

    let open_args = json!({ "task_id": 1, "brief_uri": URI, "brief_hash": EVIDENCE, "max_price": NearToken::from_near(2),
                            "timings": { "commit_secs": 30, "reveal_secs": 30, "delivery_secs": 300, "review_secs": 600 } });
    env.call_with(&env.swarm, &contractor, bot.clone(), "open_job", open_args.clone(), ZERO).await?;
    env.win_and_deliver(1, &cheater, NearToken::from_millinear(200)).await?;

    env.call_with(&env.swarm, &contractor, bot.clone(), "dispute", json!({ "job_id": 1 }), ZERO).await?;
    let job = env.job(1).await?;
    assert_eq!(job["status"], "Disputed");
    assert_eq!(job["question_id"], QID);
    let q = env.question().await?;
    assert_eq!(q["template"], "free_text");
    assert!(q["params"].as_str().unwrap().contains("job_review"));
    assert!(q["params"].as_str().unwrap().contains(EVIDENCE));

    // Three honest jurors against one bribed juror who backs the worker.
    let votes = [("atlas", "NO", 95u8), ("nova", "NO", 90), ("sage", "NO", 85), ("mallory", "YES", 60)];
    let mut jurors = Vec::new();
    for (name, answer, confidence) in votes {
        let id = create(&env.sandbox, &format!("{name}.sandbox")).await?;
        env.call(&env.sooth, &id, "register_agent", json!({ "name": name, "model": "test-model" }), NearToken::from_near(3)).await?;
        let preimage = format!("{QID}|1|{id}|{answer}|{confidence}|{EVIDENCE}|salt");
        env.call(&env.sooth, &id, "commit", json!({ "question_id": QID, "hash": hex_sha256(&preimage), "stake": NearToken::from_millinear(500) }), ZERO).await?;
        jurors.push(id);
    }
    env.wait_question("Reveal").await?;
    for (i, (_, answer, confidence)) in votes.iter().enumerate() {
        env.call(
            &env.sooth,
            &jurors[i],
            "reveal",
            json!({ "question_id": QID, "answer": answer, "confidence": confidence, "evidence_hash": EVIDENCE, "evidence_uri": URI, "salt": "salt" }),
            ZERO,
        )
        .await?;
    }
    env.wait_question("AwaitingTally").await?;
    env.call(&env.sooth, &user, "tally", json!({ "question_id": QID }), ZERO).await?;
    assert_eq!(env.question().await?["status"], "Provisional", "the jury should be confident");
    env.wait_question("AwaitingFinalize").await?;
    env.call(&env.sooth, &user, "finalize", json!({ "question_id": QID }), ZERO).await?;

    // The ruling reached the job through SOOTH's callback alone.
    let job = env.job(1).await?;
    assert_eq!(job["status"], "Closed", "SOOTH's callback should have settled the job");
    assert_eq!(job["result"], "lost_dispute");
    let worker: Value = env.swarm.call_function("get_worker", json!({ "account_id": cheater })).read_only().fetch_from(&env.net).await?.data;
    assert_eq!(worker["stats"]["failed"], 1);
    assert_eq!(worker["stats"]["slashed"], NearToken::from_millinear(500).as_yoctonear().to_string());
    let mallory: Value = env.sooth.call_function("get_agent", json!({ "account_id": jurors[3] })).read_only().fetch_from(&env.net).await?.data;
    assert_ne!(mallory["stats"]["slashed"], "0");

    // A spoofed ruling after the fact changes nothing.
    env.call(&env.swarm, &cheater, "on_sooth_resolved", json!({ "question_id": QID, "answer": "YES" }), ZERO).await?;
    assert_eq!(env.job(1).await?["result"], "lost_dispute");

    // The same job, bought again from an honest worker.
    env.call_with(&env.swarm, &contractor, bot.clone(), "open_job", open_args, ZERO).await?;
    env.win_and_deliver(2, &honest, NearToken::from_near(1)).await?;
    env.call_with(&env.swarm, &contractor, bot.clone(), "accept", json!({ "job_id": 2 }), ZERO).await?;
    assert_eq!(env.job(2).await?["result"], "accepted");

    // Budget 5 + slashed bond 0.5 - jury 0.3 - two jobs' storage 0.1 - paid 1 = 4.1 left.
    let task: Value = env.swarm.call_function("get_task", json!({ "task_id": 1 })).read_only().fetch_from(&env.net).await?.data;
    assert_eq!(task["available"], NearToken::from_millinear(4_100).as_yoctonear().to_string());
    assert_eq!(task["active_jobs"], 0);

    // The contractor's key cannot take the budget: it is off the key's method list and needs a deposit.
    let denied = env
        .swarm
        .call_function("close_task", json!({ "task_id": 1 }))
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(contractor.clone(), bot.clone())
        .send_to(&env.net)
        .await;
    assert!(denied.is_err(), "a function-call key must not close the task");

    env.call(&env.swarm, &user, "close_task", json!({ "task_id": 1 }), NearToken::from_yoctonear(1)).await?;
    Ok(())
}

async fn create(sandbox: &near_sandbox::Sandbox, name: &str) -> testresult::TestResult<AccountId> {
    let id: AccountId = name.parse()?;
    sandbox.create_account(id.clone()).initial_balance(NearToken::from_near(10)).send().await?;
    Ok(id)
}
