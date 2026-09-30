import assert from 'node:assert/strict';
import test from 'node:test';
import { createRootTraceContext } from '../apps/mycode-cli/packages/contracts/src/index.ts';
import { InMemoryRuntimeTaskRegistry } from '../apps/mycode-cli/packages/core/src/runtime-task/registry.ts';
import { maybeEnqueueBackgroundTaskNotification } from '../apps/mycode-cli/packages/core/src/tool/executor/background-task-notifications.ts';
import { resolveBackgroundTaskLifecycleProvider } from '../apps/mycode-cli/packages/core/src/tool/executor/background-task-lifecycle-provider.ts';

const trace = createRootTraceContext({ sessionId: 'notification-test' });
const workflow = { id: 'tool-1', name: 'CreateWorkflow', input: { name: 'Example workflow' } };
function fixture() {
  const messages = [];
  const runtimeTaskRegistry = new InMemoryRuntimeTaskRegistry();
  runtimeTaskRegistry.register({ taskId: 'run-1', type: 'local_dynamic_workflow', status: 'completed', notified: false, startedAt: new Date() });
  return { messages, deps: { runtimeTaskRegistry, getWorkingDirectory: () => process.cwd(), enqueueBackgroundTaskNotification: message => messages.push(message) } };
}

test('completed workflow notification is claimed once and uses durable output', () => {
  const f = fixture();
  const snapshot = { status: 'completed', runStatus: 'completed', output: { answer: 'DURABLE_RESULT' }, reports: ['PARTIAL_REPORT'] };
  for (let i=0;i<2;i++) maybeEnqueueBackgroundTaskNotification(f.deps, workflow, 'run-1', 'completed', snapshot, trace, { response: 'STALE_LAUNCH_RESPONSE' });
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].text, /DURABLE_RESULT/);
  assert.match(f.messages[0].text, /PARTIAL_REPORT/);
  assert.doesNotMatch(f.messages[0].text, /STALE_LAUNCH_RESPONSE/);
  assert.equal(f.messages[0].originMeta.workId, 'run-1');
  assert.equal(f.deps.runtimeTaskRegistry.get('run-1').notified, true);
});

test('superseded workflow is claimed without emitting a duplicate stop notification', () => {
  const f = fixture();
  maybeEnqueueBackgroundTaskNotification(f.deps, workflow, 'run-1', 'cancelled', { status: 'cancelled', runStatus: 'stopped', stopReason: 'superseded' }, trace);
  assert.equal(f.messages.length, 0);
  assert.equal(f.deps.runtimeTaskRegistry.get('run-1').notified, true);
});

test('enqueue failure releases the claim so a later delivery can succeed', () => {
  const f = fixture();
  const enqueue = f.deps.enqueueBackgroundTaskNotification;
  f.deps.enqueueBackgroundTaskNotification = () => { throw new Error('queue unavailable'); };
  maybeEnqueueBackgroundTaskNotification(f.deps, workflow, 'run-1', 'failed', { status: 'failed' }, trace);
  assert.equal(f.deps.runtimeTaskRegistry.get('run-1').notified, false);
  f.deps.enqueueBackgroundTaskNotification = enqueue;
  maybeEnqueueBackgroundTaskNotification(f.deps, workflow, 'run-1', 'failed', { status: 'failed' }, trace);
  assert.equal(f.messages.length, 1);
  assert.equal(f.deps.runtimeTaskRegistry.get('run-1').notified, true);
});

test('runtime suppression leaves a task unclaimed for its proper delivery owner', () => {
  const f = fixture();
  f.deps.shouldEnqueueBackgroundTaskNotification = () => false;
  maybeEnqueueBackgroundTaskNotification(f.deps, workflow, 'run-1', 'completed', { status: 'completed' }, trace);
  assert.equal(f.messages.length, 0);
  assert.equal(f.deps.runtimeTaskRegistry.get('run-1').notified, false);
});

test('new and resumed workflow runs use the same lifecycle port with bound methods', async () => {
  const port = { marker: 'bound-port', getTask(id) { assert.equal(this.marker, 'bound-port'); return { taskId: id }; }, waitForTask(id) { assert.equal(this.marker, 'bound-port'); return Promise.resolve({ taskId: id, status: 'completed' }); }, cancel() {} };
  for (const name of ['CreateWorkflow', 'ResumeWorkflowRun']) {
    const lifecycle = resolveBackgroundTaskLifecycleProvider({ dynamicWorkflowRunPort: port }, { ...workflow, name });
    assert.equal(lifecycle.cancellable, true);
    assert.deepEqual(await lifecycle.getSnapshot('run-1'), { taskId: 'run-1' });
    assert.equal((await lifecycle.waitForTerminal('run-1')).status, 'completed');
  }
  const legacy = resolveBackgroundTaskLifecycleProvider({ workflowPort: port }, { ...workflow, name: 'Workflow' });
  assert.equal(legacy.cancellable, false);
});
