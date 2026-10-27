//! End to end on a local sandbox: the real wasm, real blocks, and one agent that only holds a
//! function-call key (commit + reveal). Mirrors the unit test `finalize_rewards_the_right_and_slashes_the_liar`.
use near_api::signer::generate_secret_key;
use near_api::types::transaction::actions::{AccessKeyPermission, FunctionCallPermission};
use near_api::{Account, AccountId, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};
use sooth::{Answer, commit_preimage, hex_sha256};

/// sha256 of the empty string, a valid 64-char evidence hash for the test.
const EVIDENCE: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const QID: u64 = 1;

#[tokio::test]
async fn full_round_on_sandbox() -> testresult::TestResult<()> {
    let wasm = std::fs::read(cargo_near_build::build_with_cli(Default::default())?)?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    // Every sandbox account starts with the genesis key, so it acts as each account's full key.
    let full_key = Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse().unwrap())?;

    let contract_id = create(&sandbox, "sooth.sandbox").await?;
    let treasury = create(&sandbox, "treasury.sandbox").await?;
    let asker = create(&sandbox, "asker.sandbox").await?;
    let contract = Account(contract_id.clone()).as_contract();
    near_api::Contract::deploy(contract_id.clone())
        .use_code(wasm)
        .with_init_call("new", json!({ "owner": contract_id, "dao_account": contract_id, "treasury": treasury }))?
        .with_signer(full_key.clone())
        .send_to(&net)
        .await?
        .assert_success();

    // 3 honest agents + mallory; YES weight share ≈ 81 %, so round 1 auto-resolves.
    let votes = [("atlas", Answer::Yes, 90u8), ("nova", Answer::Yes, 85), ("sage", Answer::Yes, 80), ("mallory", Answer::No, 60)];
    let mut ids = Vec::new();
    for (name, _, _) in votes {
        let id = create(&sandbox, &format!("{name}.sandbox")).await?;
        contract
            .call_function("register_agent", json!({ "name": name, "model": "test-model" }))
            .transaction()
            .deposit(NearToken::from_near(3))
            .with_signer(id.clone(), full_key.clone())
            .send_to(&net)
            .await?
            .assert_success();
        ids.push(id);
    }

    // atlas runs on a bot key that can only commit and reveal.
    let bot_secret = generate_secret_key()?;
    Account(ids[0].clone())
        .add_key(
            AccessKeyPermission::FunctionCall(FunctionCallPermission {
                allowance: Some(NearToken::from_millinear(250)),
                receiver_id: contract_id.to_string(),
                method_names: vec!["commit".into(), "reveal".into()],
            }),
            bot_secret.public_key(),
        )
        .with_signer(full_key.clone())
        .send_to(&net)
        .await?
        .assert_success();
    let bot_key = Signer::from_secret_key(bot_secret)?;
    let signer_for = |i: usize| if i == 0 { bot_key.clone() } else { full_key.clone() };

    contract
        .call_function(
            "ask_question",
            json!({ "text": "Did it rain at least 1 mm in Mumbai on 5 Nov 2026?", "category": "weather",
                    "template": "weather_rain", "params": "{}", "resolve_after": "0",
                    "min_stake": NearToken::from_millinear(500),
                    "timings": { "commit_secs": 30, "reveal_secs": 30, "challenge_secs": 30 } }),
        )
        .transaction()
        .deposit(NearToken::from_millinear(300))
        .with_signer(asker.clone(), full_key.clone())
        .send_to(&net)
        .await?
        .assert_success();

    for (i, (_, answer, confidence)) in votes.iter().enumerate() {
        let sdk_id: near_sdk::AccountId = ids[i].as_str().parse()?;
        let hash = hex_sha256(&commit_preimage(QID, 1, &sdk_id, *answer, *confidence, EVIDENCE, "salt"));
        contract
            .call_function("commit", json!({ "question_id": QID, "hash": hash, "stake": NearToken::from_millinear(500) }))
            .transaction()
            .with_signer(ids[i].clone(), signer_for(i))
            .send_to(&net)
            .await?
            .assert_success();
    }

    wait_for_phase(&sandbox, &contract, &net, "Reveal").await?;
    for (i, (_, answer, confidence)) in votes.iter().enumerate() {
        contract
            .call_function(
                "reveal",
                json!({ "question_id": QID, "answer": answer, "confidence": confidence, "evidence_hash": EVIDENCE,
                        "evidence_uri": "https://example.com/e.json", "salt": "salt" }),
            )
            .transaction()
            .with_signer(ids[i].clone(), signer_for(i))
            .send_to(&net)
            .await?
            .assert_success();
    }

    wait_for_phase(&sandbox, &contract, &net, "AwaitingTally").await?;
    crank(&contract, &net, "tally", &asker, &full_key).await?;
    assert_eq!(question(&contract, &net).await?["status"], "Provisional");

    wait_for_phase(&sandbox, &contract, &net, "AwaitingFinalize").await?;
    crank(&contract, &net, "finalize", &asker, &full_key).await?;
    let q = question(&contract, &net).await?;
    assert_eq!(q["status"], "Finalized");
    assert_eq!(q["outcome"]["answer"], "YES");

    let mallory = agent(&contract, &net, &ids[3]).await?;
    assert_eq!(mallory["stats"]["slashed"], NearToken::from_millinear(300).as_yoctonear().to_string());
    let atlas = agent(&contract, &net, &ids[0]).await?;
    assert_eq!(atlas["stats"]["correct"], 1);
    assert_ne!(atlas["stats"]["earned"], "0");
    Ok(())
}

async fn create(sandbox: &near_sandbox::Sandbox, name: &str) -> testresult::TestResult<AccountId> {
    let id: AccountId = name.parse()?;
    sandbox.create_account(id.clone()).initial_balance(NearToken::from_near(10)).send().await?;
    Ok(id)
}

async fn question(contract: &near_api::Contract, net: &NetworkConfig) -> testresult::TestResult<Value> {
    Ok(contract.call_function("get_question", json!({ "question_id": QID })).read_only().fetch_from(net).await?.data)
}

async fn agent(contract: &near_api::Contract, net: &NetworkConfig, id: &AccountId) -> testresult::TestResult<Value> {
    Ok(contract.call_function("get_agent", json!({ "account_id": id })).read_only().fetch_from(net).await?.data)
}

async fn crank(
    contract: &near_api::Contract,
    net: &NetworkConfig,
    method: &str,
    caller: &AccountId,
    key: &std::sync::Arc<Signer>,
) -> testresult::TestResult<()> {
    contract
        .call_function(method, json!({ "question_id": QID }))
        .transaction()
        .with_signer(caller.clone(), key.clone())
        .send_to(net)
        .await?
        .assert_success();
    Ok(())
}

/// Produce blocks until the question reaches `phase` (sandbox time moves with blocks).
async fn wait_for_phase(
    sandbox: &near_sandbox::Sandbox,
    contract: &near_api::Contract,
    net: &NetworkConfig,
    phase: &str,
) -> testresult::TestResult<()> {
    for _ in 0..120 {
        if question(contract, net).await?["phase"] == phase {
            return Ok(());
        }
        sandbox.fast_forward(5).await?;
    }
    panic!("question never reached phase {phase}");
}
