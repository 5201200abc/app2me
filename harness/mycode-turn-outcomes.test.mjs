import assert from 'node:assert/strict';
import test from 'node:test';
import { failRegularTurn } from '../apps/mycode-cli/packages/core/src/runtime/methods/turn-lifecycle-outcomes.ts';
import { CoreErrorType, createCoreError, createRootTraceContext } from '../apps/mycode-cli/packages/contracts/dist/index.js';

function fixture({ cancelled = false, preserve = false } = {}) {
  const order = [];
  const controller = new AbortController();
  if (cancelled) controller.abort();
  const traceContext = createRootTraceContext({ sessionId: 'session', turnId: 'turn' });
  const context = { options: { inputId: 'input', workflowResultConsumed: true }, turnId: 'turn', turnTraceContext: traceContext, turnAbortSignal: controller.signal, turnStartedAtMs: Date.now(), targetRunInputID: 'input', events: [] };
  const startedTarget = { targetID: 'goal', status: 'active' };
  const finishedTarget = { targetID: 'goal', status: cancelled ? 'paused' : 'active', totalTokens: 7 };
  const outcome = { activeTurn: { pendingInputs: [{ id: 'queued' }] }, startedTarget, turnMachine: { state: { startedAt: new Date(), phase: 'running' } }, userMessageId: 'user-message', loopState: undefined };
  const runtime = { sessionId: 'session', queueAutoDrain: true, queueExternalDrainActive: true, activeForegroundExecution: { preserveQueueAutoDrainOnCancel: preserve }, finishTargetTurnAccounting: async () => { order.push('account'); return finishedTarget; }, pauseActiveTargetForCancellation: async () => { order.push('pause'); }, fallbackPendingGuidesToQueue: async () => { order.push('guides'); }, rebuildProjection: async () => ({ pendingSteerInputs: [{ id: 'queued' }] }), createEvent: (type,payload) => ({ type,payload,timestamp: new Date() }), appendEvent: async () => { order.push('event'); } };
  return { runtime, context, outcome, order, finishedTarget };
}

test('provider failure holds queued inputs and keeps the consumed workflow result fact', async () => {
  const f = fixture();
  const error = createCoreError(CoreErrorType.ModelError, 'Provider refused the request');
  await assert.rejects(failRegularTurn.call(f.runtime,f.context,f.outcome,error,target=>{f.order.push('target');assert.equal(target,f.finishedTarget);}), actual=>actual===error);
  assert.deepEqual(f.order,['account','target','event']);
  assert.equal(f.runtime.queueAutoDrain,false);
  assert.equal(f.runtime.queueExternalDrainActive,false);
  assert.equal(f.context.events[0].type,'turn_error');
  assert.equal(f.context.events[0].payload.workflowResultConsumed,true);
  assert.equal(f.outcome.activeTurn.pendingInputs.length,1);
});

for (const preserve of [false,true]) {
  test(`cancellation updates goal before guide fallback and preserves queue authorization=${preserve}`, async () => {
    const f=fixture({cancelled:true,preserve});
    await assert.rejects(failRegularTurn.call(f.runtime,f.context,f.outcome,new Error('aborted'),target=>{f.order.push('target');assert.equal(target,f.finishedTarget);}), error=>error.type===CoreErrorType.TurnCancelled);
    assert.deepEqual(f.order,['account','target','pause','guides','event']);
    assert.equal(f.runtime.queueAutoDrain,preserve);
    assert.equal(f.runtime.queueExternalDrainActive,preserve);
    assert.equal(f.context.events[0].type,'turn_complete');
    assert.equal(f.context.events[0].payload.resultType,'cancelled');
    assert.equal(f.context.events[0].payload.preserveQueueAutoDrainOnCancel,preserve?true:undefined);
  });
}
