import { Mastra } from '@mastra/core/mastra';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';

const [action, directory] = process.argv.slice(2);
const release = Promise.withResolvers();
const entered = Promise.withResolvers();
const emit = (event, data = {}) => process.send({ event, pid: process.pid, ...data });
process.on('message', message => {
  if (message === 'release') release.resolve();
});
process.on('disconnect', () => process.exit(2));
const watchdog = setTimeout(() => {
  console.error(`Worker ${action} did not finish within 60 seconds`);
  process.exit(2);
}, 60_000);

const schema = z.object({});
let laterStepExecuted = false;
const held = createStep({
  id: 'held',
  inputSchema: schema,
  outputSchema: schema,
  execute: async ({ abortSignal }) => {
    entered.resolve();
    emit('step-entered');
    await release.promise;
    emit('step-finished', { aborted: abortSignal.aborted });
    return {};
  },
});
const later = createStep({
  id: 'later',
  inputSchema: schema,
  outputSchema: schema,
  execute: async () => {
    laterStepExecuted = true;
    emit('later-step');
    return {};
  },
});
const workflow = createWorkflow({ id: 'cancel-example', inputSchema: schema, outputSchema: schema })
  .then(held)
  .then(later)
  .commit();
const storage = new LibSQLStore({ id: 'repro', url: `file:${directory}/workflow.db` });
new Mastra({ workflows: { example: workflow }, storage, logger: false });

try {
  await storage.init();
  const run = await workflow.createRun({ runId: 'one' });
  if (action === 'cancel') {
    emit('before-cancel', { status: (await workflow.getWorkflowRunById('one'))?.status });
    await run.cancel();
    emit('cancel-returned', { status: (await workflow.getWorkflowRunById('one'))?.status });
  } else {
    const resultPromise = run.start({ inputData: {} });
    if (action === 'local') {
      await entered.promise;
      await run.cancel();
      emit('cancel-returned', { status: (await workflow.getWorkflowRunById('one'))?.status });
    }
    const result = await resultPromise;
    emit('result', {
      status: result.status,
      persistedStatus: (await workflow.getWorkflowRunById('one'))?.status,
      laterStepExecuted,
    });
  }
} finally {
  await storage.close();
  clearTimeout(watchdog);
  process.removeAllListeners('disconnect');
  process.disconnect();
}
