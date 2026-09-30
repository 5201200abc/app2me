import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { AgentExecutionTelemetryRuntime } from '../apps/mycode-cli/packages/telemetry/src/agent-trace-runtime.ts';

const require = createRequire(new URL('../apps/mycode-cli/packages/telemetry/package.json', import.meta.url));
const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const { context } = require('@opentelemetry/api');
const target = { providerId: 'deepseek', providerKind: 'openai-compatible', requestedModel: 'deepseek-flash', reasoning: { capability: 'supported', requestedState: 'disabled', requestedControl: 'toggle' } };
const turnInput = sessionId => ({ context: { actorKind: 'main', launchSurface: 'cli', sessionId, turnId: `${sessionId}-turn` }, turnNumber: 1 });
function fixture(options = {}) {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const manager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(manager);
  const runtime = new AgentExecutionTelemetryRuntime({ tracer: provider.getTracer('registry-test'), ...options });
  return { exporter, runtime, close: async () => { runtime.abandonProcess(); await provider.shutdown(); context.disable(); manager.disable(); } };
}

test('model call and attempts retain parent trace and canonical telemetry attributes', async () => {
  const f = fixture();
  try {
    const turn = f.runtime.startTurn(turnInput('parent-session'));
    await turn.run(async () => {
      const causation = f.runtime.captureCausation();
      assert.equal(causation.sessionId, 'parent-session');
      const call = f.runtime.startCall({ logicalCallId: 'call-1', operation: 'chat', requested: target, streaming: true, callCause: 'initial', modelRole: 'primary' });
      await call.run(async () => {
        const attempt = call.startAttempt({ apiOperation: 'chat_completions', attemptNumber: 1, maxAttempts: 2, requestId: 'request-1', target, transport: 'openai-compatible', attemptCause: 'initial' });
        await attempt.run(async () => { attempt.setResponseModel({ model: 'deepseek-flash' }); attempt.setFinishReason('stop'); attempt.finishCompleted(); });
        call.finishCompleted();
      });
      turn.finishCompleted('assistant_message');
    });
    const spans = f.exporter.getFinishedSpans();
    assert.deepEqual(spans.map(s=>s.name).sort(), ['agent_turn','model_attempt','model_call']);
    const byName = Object.fromEntries(spans.map(s=>[s.name,s]));
    assert.equal(byName.model_call.parentSpanContext.spanId, byName.agent_turn.spanContext().spanId);
    assert.equal(byName.model_attempt.parentSpanContext.spanId, byName.model_call.spanContext().spanId);
    assert.equal(new Set(spans.map(s=>s.spanContext().traceId)).size, 1);
    assert.equal(byName.model_call.attributes['mycode.execution.logical_call_id'], 'call-1');
    assert.equal(byName.model_attempt.attributes['mycode.model_attempt.request_id'], 'request-1');
    assert.equal(byName.model_attempt.attributes['mycode.model_attempt.requested_model'], 'deepseek-flash');
  } finally { await f.close(); }
});

test('writer capacity recovers after session abandonment and does not abandon other sessions', async () => {
  const warnings = [];
  const f = fixture({ maxActiveWriters: 2, onWarning: (...args) => warnings.push(args) });
  try {
    const first = f.runtime.startTurn(turnInput('first'));
    const second = f.runtime.startTurn(turnInput('second'));
    f.runtime.startTurn(turnInput('dropped')).finishCompleted();
    f.runtime.startTurn(turnInput('also-dropped')).finishCompleted();
    assert.equal(warnings.length, 1);
    assert.equal(f.exporter.getFinishedSpans().length, 0);
    f.runtime.abandonSession('first');
    assert.equal(f.exporter.getFinishedSpans().length, 1);
    const replacement = f.runtime.startTurn(turnInput('replacement'));
    replacement.finishCompleted();
    second.finishCompleted();
    first.finishCompleted();
    assert.equal(f.exporter.getFinishedSpans().length, 3);
    assert.equal(warnings.length, 1);
  } finally { await f.close(); }
});
