import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelProtocolError, ModelErrorCode } from '../apps/mycode-cli/packages/contracts/dist/index.js';
import { createStatusContext } from '../apps/mycode-cli/packages/adapters/src/model/runner-status.ts';
import { handleGenerateTextAttemptFailure } from '../apps/mycode-cli/packages/adapters/src/model/runner-generate-retry.ts';

function fixture() {
  const events = [], ticketEvents = [];
  let released = 0;
  const input = { env: {}, request: { messages: [{ role: 'user', content: 'Test request' }] }, resolved: { providerId: 'fixture', modelId: 'fixture', providerKind: 'openai-compatible' }, retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, backoffFactor: 1, jitter: false }, modelIoFullRetentionEnabled: false, statusSink: { publish: event => events.push(event) } };
  const statusContext = createStatusContext({ maxAttempts: 2, request: input.request, resolved: input.resolved, transport: 'http' });
  const state = { attempt: 1, retryBudgetAttempt: 1, attemptRequest: input.request, startedAt: Date.now(), resolved: input.resolved, statusContext, options: undefined, requestInvocationCompleted: true, requestHeaders: {}, requestHeaderCount: 0, admission: { release: () => { released++; }, ticket: { publish: event => ticketEvents.push(event) } }, requestMessages: input.request.messages, signatureRepairAttempted: false, retryBudget: undefined, statusMaxAttempts: extra => input.retry.maxAttempts + extra, recordModelIO: false, isDev: false };
  return { input, state, events, ticketEvents, released: () => released };
}
const unavailable = () => Object.assign(new Error('Service unavailable'), { statusCode: 503 });

test('transient failure schedules retry and releases admission before backoff', async () => {
  const f = fixture();
  const result = await handleGenerateTextAttemptFailure(f.input, f.state, unavailable());
  assert.equal(result.requestMessages, f.input.request.messages);
  assert.equal(result.signatureRepairAttempted, false);
  assert.equal(result.attemptOffset, 0);
  assert.deepEqual(f.events.map(e=>e.type), ['model_request_failed', 'model_retry_scheduled']);
  assert.equal(f.events[0].retryable, true);
  assert.equal(f.released(), 1);
});

test('exhausted bounded retry rejects without scheduling another request', async () => {
  const f = fixture();
  f.state.attempt = f.state.retryBudgetAttempt = 2;
  await assert.rejects(handleGenerateTextAttemptFailure(f.input, f.state, unavailable()));
  assert.deepEqual(f.events.map(e=>e.type), ['model_request_failed']);
  assert.equal(f.events[0].retryable, false);
  assert.equal(f.released(), 0); // The caller's finally owns release when no backoff runs.
});

test('missing authentication preserves its typed error identity', async () => {
  const f = fixture();
  const error = new ModelProtocolError(ModelErrorCode.ModelRequestAuthMissing, 'Missing fixture credentials');
  await assert.rejects(handleGenerateTextAttemptFailure(f.input, f.state, error), actual=>actual===error);
  assert.equal(f.events.length, 0);
});

test('cancellation during backoff is terminal and bypasses the released admission ticket', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.input.request.abortSignal = controller.signal;
  f.input.statusSink.publish = event => { f.events.push(event); if(event.type==='model_retry_scheduled') controller.abort(); };
  await assert.rejects(handleGenerateTextAttemptFailure(f.input, f.state, unavailable()), error=>error.code===ModelErrorCode.ModelRequestCancelled);
  assert.equal(f.released(), 1);
  assert.equal(f.events.at(-1).retryable, false);
  assert.equal(f.events.at(-1).type, 'model_request_failed');
  assert.equal(f.ticketEvents.length, 2);
  assert.equal(f.events.length, 3);
});

test('thinking signature repair changes only the request copy and grants one extra attempt', async () => {
  const f = fixture();
  f.state.resolved = { ...f.state.resolved, providerKind: 'anthropic' };
  const messages = [{ role: 'assistant', content: [{ type: 'reasoning', text: 'private fixture reasoning', providerOptions: { anthropic: { signature: 'rejected-fixture-signature' } } }, { type: 'text', text: 'Visible response' }] }];
  f.state.requestMessages = messages;
  const original = structuredClone(messages);
  const error = Object.assign(new Error('Invalid signature in thinking block'), { statusCode: 400 });
  const result = await handleGenerateTextAttemptFailure(f.input, f.state, error);
  assert.equal(result.signatureRepairAttempted, true);
  assert.equal(result.attemptOffset, 0);
  assert.deepEqual(messages, original);
  assert.notEqual(result.requestMessages, messages);
  assert.equal(result.requestMessages[0].content.some(block=>block.type==='reasoning'), false);
  assert.equal(f.events[0].maxAttempts, 3);
  assert.equal(f.events.at(-1).delayMs, 0);
});
