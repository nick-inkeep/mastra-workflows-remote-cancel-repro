import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

const mode = process.argv[2];
assert.ok(mode === 'remote' || mode === 'local', 'Use remote or local');
const directory = await mkdtemp(path.join(import.meta.dirname, '.runs-'));
const children = [];

function start(action) {
  const child = fork(new URL('./worker.mjs', import.meta.url), [action, directory], {
    execArgv: [],
    env: {
      PATH: path.dirname(process.execPath),
      HOME: directory,
      TMPDIR: directory,
      TZ: 'UTC',
      MASTRA_TELEMETRY_DISABLED: '1',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      OPENROUTER_API_KEY: '',
      GOOGLE_GENERATIVE_AI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const messages = [];
  const waiters = [];
  let stderr = '';
  child.stdout.pipe(process.stdout);
  child.stderr.on('data', data => { stderr += data; });
  child.on('message', message => {
    messages.push(message);
    console.log(JSON.stringify(message));
    for (const wake of waiters.splice(0)) wake();
  });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      for (const wake of waiters.splice(0)) wake();
      if (code === 0 && signal === null) resolve();
      else reject(new Error(`${action}: code=${code} signal=${signal} stderr=${stderr}`));
    });
  });
  closed.catch(() => {});
  const wait = async event => {
    while (!messages.some(message => message.event === event)) {
      const next = new Promise(resolve => waiters.push(resolve));
      await Promise.race([next, closed.then(() => { throw new Error(`${action} closed before ${event}`); })]);
    }
    return messages.find(message => message.event === event);
  };
  const handle = { child, closed, wait };
  children.push(handle);
  return handle;
}

try {
  const executor = start(mode === 'local' ? 'local' : 'start');
  await executor.wait('step-entered');
  const canceler = mode === 'remote' ? start('cancel') : executor;
  if (mode === 'remote') assert.equal((await canceler.wait('before-cancel')).status, 'running');
  assert.equal((await canceler.wait('cancel-returned')).status, 'canceled');
  if (mode === 'remote') await canceler.closed;
  executor.child.send('release');
  const result = await executor.wait('result');
  await executor.closed;
  console.log(JSON.stringify({ mode, ...result }));
  assert.equal(result.status, 'canceled', 'The active execution must honor cancellation');
  assert.equal(result.persistedStatus, 'canceled', 'Cancellation must remain persisted');
  assert.equal(result.laterStepExecuted, false, 'No subsequent step should execute');
} finally {
  for (const { child } of children) {
    if (child.connected) child.disconnect();
  }
  await Promise.allSettled(children.map(child => child.closed));
  await rm(directory, { recursive: true, force: true });
}
