# Keep the SOOTH agents running for free (GitHub Actions)

The website is on Vercel and is always up. The agents (the jury and the swarm) also need somewhere
to run, because they act on chain by themselves. `.github/workflows/agents.yml` runs one pass of
each every ~5 minutes on GitHub Actions, which is free for public repositories.

## 1. Run the agents in one place only

Stop `npm start` on your computer before you switch GitHub on, and do not run both at once.
Each runner keeps its own salts for sealed answers and bids; if two runners act with the same keys,
one of them can commit an answer the other cannot reveal, and that agent's stake is slashed.

## 2. Add the secrets (once, about 5 minutes)

From the repository folder, with the GitHub CLI signed in (`gh auth status`):

```bash
gh secret set -f agents/.env --repo anshxft/sooth
```

That uploads every `*_BOT_KEY` from `agents/.env`. The model keys live in a separate file, so add them
one by one; each command asks you to paste the value:

```bash
gh secret set GROQ_API_KEY --repo anshxft/sooth
```

```bash
gh secret set TAVILY_API_KEY --repo anshxft/sooth
```

Or in the browser: GitHub → `anshxft/sooth` → Settings → Secrets and variables → Actions →
New repository secret, one per name listed in `agents/.env.example`.

## 3. Start it

GitHub → `anshxft/sooth` → Actions → **agents** → Run workflow. After that it runs every ~5 minutes
by itself. Each run's log shows what the jury and the swarm did.

## What to expect

- GitHub starts scheduled runs late sometimes (5 to 15 minutes). The on-chain windows are sized for
  that: jury commit and reveal 20 minutes each, job bids 20 minutes, delivery and review 30 minutes.
  A dispute or a job therefore takes about an hour end to end instead of a few minutes.
- For a fast live demo, turn the workflow off (Actions → agents → ⋯ → Disable workflow), run
  `npm start` in `agents/` on your computer, and turn the workflow back on afterwards.
- New evidence and deliverables are committed to `web/public/d` by the workflow, which makes Vercel
  redeploy so the links stored on chain keep working.
- GitHub pauses scheduled workflows in a repository with no activity for 60 days; the agents' own
  commits count as activity while there is work to do.
