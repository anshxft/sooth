// Keeps the jury (run.mts) and the job market (swarm.mts) running unattended: restarts a runtime that
// exits, with a growing pause so a hard failure does not spin. Both runtimes save salts before they
// send a commit, so a restart never loses a sealed vote or bid.
//   node supervise.mts        (npm start)   logs go to .state/logs/<name>.log
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { HERE, log } from './lib.mts'

const RUNTIMES = ['run.mts', 'swarm.mts']
const MIN_PAUSE_MS = 5_000
const MAX_PAUSE_MS = 5 * 60_000
const HEALTHY_AFTER_MS = 60_000 // a run this long resets the pause

mkdirSync(new URL('.state/logs/', HERE), { recursive: true })

function keepAlive(script: string, pause = MIN_PAUSE_MS) {
  const name = script.replace('.mts', '')
  const out = createWriteStream(new URL(`.state/logs/${name}.log`, HERE), { flags: 'a' })
  const started = Date.now()
  const child = spawn(process.execPath, [script], { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(out)
  child.stderr.pipe(out)
  log('supervise', `${name} started (pid ${child.pid})`)
  child.on('exit', (code) => {
    const next = Date.now() - started > HEALTHY_AFTER_MS ? MIN_PAUSE_MS : Math.min(pause * 2, MAX_PAUSE_MS)
    log('supervise', `${name} exited with ${code}; restarting in ${next / 1000} s`)
    setTimeout(() => keepAlive(script, next), next)
  })
}

for (const script of RUNTIMES) keepAlive(script)
