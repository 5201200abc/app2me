import assert from 'node:assert/strict';
import test from 'node:test';
import { respondToWorkspaceHookReview, toggleWorkspaceHookReviewItem } from '../apps/mycode-cli/packages/bootstrap/src/app/workspace-hook-review-commands.ts';

const target = { workspaceIdentity: 'workspace', bundleDigest: 'digest', interactionId: 'review-1' };
const decision = { action: 'trust_selected', reviewItemIds: ['hook-1'] };
function fixture() {
  const events = [];
  const accepted = { accepted: true, reviewItemIds: ['hook-1'] };
  const snapshot = { workspaceIdentity: 'workspace', bundleDigest: 'digest', hooks: [{ reviewItemId: 'hook-1', editable: true }] };
  const context = {
    sessionId: 'session',
    admission: { getCurrentSnapshot: () => snapshot, invalidate: reason => events.push(['invalidate', reason]), replaceSnapshot: () => events.push(['replace']) },
    registry: { validate: () => accepted, getCurrentFlow: () => ({ request: { items: [{ configuredEnabled: true }] } }), resolve: () => accepted, fail: (...args) => events.push(['fail', ...args]) },
    coordinator: { canMutatePersistentTrust: () => true },
    telemetry: Object.fromEntries(['responseRejected','trustStoreFailure','decisionAccepted','toggleFailure'].map(name=>[name, (...args)=>events.push([name,...args])])),
    host: { emit: async event => events.push(['emit', event]) },
    mutation: { toggle: async () => snapshot },
    applyPersistentTrust: async () => { events.push(['grant']); return { grantedRecordCount: 1 }; },
    refreshPendingFlow: async () => { events.push(['refresh']); },
    emitAdmissionUpdatedAfterMutation: async () => { events.push(['admission']); },
  };
  return { context, events, snapshot };
}

for (const mode of ['stale_snapshot', 'blocked_policy']) {
  test(`hook trust rejects ${mode} before persisting`, async () => {
    const f = fixture();
    if (mode === 'stale_snapshot') f.snapshot.bundleDigest = 'new-digest';
    else f.context.coordinator.canMutatePersistentTrust = () => false;
    const result = await respondToWorkspaceHookReview(f.context, target, decision);
    assert.equal(result.accepted, false);
    assert.equal(result.reasonCode, mode === 'stale_snapshot' ? 'workspace_hooks_snapshot_mismatch' : 'workspace_hooks_blocked_by_policy');
    assert.equal(f.events.some(e=>e[0]==='grant'), false);
  });
}

test('trust persisted before a deadline race remains accepted and settles the UI', async () => {
  const f = fixture();
  f.context.registry.resolve = () => ({ accepted: false, reasonCode: 'workspace_hooks_review_superseded' });
  assert.equal((await respondToWorkspaceHookReview(f.context, target, decision)).accepted, true);
  assert.deepEqual(f.events.filter(e=>['grant','admission','refresh'].includes(e[0])).map(e=>e[0]), ['grant','admission','refresh']);
  assert.equal(f.events.find(e=>e[0]==='emit')[1].payload.state, 'resolved');
});

test('trust store failure does not settle a review as accepted', async () => {
  const f = fixture();
  f.context.applyPersistentTrust = async () => { throw new Error('persist failed'); };
  const result = await respondToWorkspaceHookReview(f.context, target, decision);
  assert.equal(result.reasonCode, 'workspace_hooks_trust_store_corrupt');
  assert.equal(f.events.some(e=>e[0]==='emit'), false);
});

test('toggle preserves a pre-write snapshot error and post-write invalidation semantics', async () => {
  const before = fixture();
  before.context.mutation.toggle = async () => { throw Object.assign(new Error('snapshot moved'), { name: 'WorkspaceHookMutationError', code: 'workspace_hooks_snapshot_mismatch' }); };
  assert.equal((await toggleWorkspaceHookReviewItem(before.context, target, 'hook-1', false)).reasonCode, 'workspace_hooks_snapshot_mismatch');
  assert.equal(before.events.some(e=>e[0]==='invalidate'), false);
  const after = fixture();
  after.context.mutation.toggle = async (_, committed) => { committed(); throw new Error('rebuild failed'); };
  assert.equal((await toggleWorkspaceHookReviewItem(after.context, target, 'hook-1', false)).reasonCode, 'workspace_hooks_config_rebuild_failed');
  assert.equal(after.events.some(e=>e[0]==='invalidate'), true);
  assert.equal(after.events.find(e=>e[0]==='emit')[1].payload.state, 'configuration_error');
});
