import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteSessionStore } from '../apps/mycode-cli/packages/adapters/src/storage/session-store/sqlite-session-store.ts';

const session = (id, parentID) => ({ id, parentID, projectID: 'project', slug: id, directory: process.cwd(), title: id, version: 'test' });
const message = (sessionID) => ({
  info: { id: `${sessionID}-message`, sessionID, role: 'user', agent: 'main', time: { created: 1000 } },
  parts: [{ id: `${sessionID}-part`, sessionID, messageID: `${sessionID}-message`, type: 'text', text: 'copied context' }],
});
async function forkFixture(store) {
  await store.createSession(session('parent'));
  const source = await store.setTarget({ sessionID: 'parent', objective: 'Keep the fork atomic', tokenBudget: 1000 });
  return {
    child: session('child', 'parent'), messages: [message('child')],
    entries: [{ id: 'child-entry', sessionID: 'child', type: 'v4/command_fact', time: { created: 1000, updated: 1000 }, data: { test: true } }],
    goal: { source: { ...source, sessionID: 'child' }, status: 'active' },
    initialInput: { id: 'child-input', sessionID: 'child', kind: 'prompt', delivery: 'startNow', payload: { text: 'Continue' } },
    commandFact: { parentSessionId: 'parent', sourceCommandId: 'fork-command', ack: { commandId: 'fork-command', status: 'accepted', revisionAtDecision: 1, result: { type: 'forkAssistant', sessionId: 'child' } }, metadata: {} },
  };
}

for (const stage of ['afterChild', 'afterMessages', 'afterGoal', 'afterEntries', 'afterInput', 'afterCommandFact', 'beforeCommit']) {
  test(`fork rollback is atomic at ${stage}`, async () => {
    const store = new SqliteSessionStore({ dbPath: ':memory:', forkCommitFaultAt: stage });
    try {
      const bundle = await forkFixture(store);
      const before = store.debugCounts();
      await assert.rejects(store.commitForkBundle(bundle), new RegExp(`injected fork commit fault: ${stage}`));
      assert.deepEqual(store.debugCounts(), before);
      assert.equal(await store.getSession('child'), null);
      assert.equal(await store.getSessionInputById('child-input'), null);
      assert.equal(await store.readTarget({ sessionID: 'child' }), null);
      assert.deepEqual(await store.sessionEntries({ sessionID: 'parent' }), []);
      assert.equal((await store.readTarget({ sessionID: 'parent' })).objective, bundle.goal.source.objective);
    } finally { store.close(); }
  });
}

test('successful fork is complete and duplicate command is idempotent', async () => {
  const store = new SqliteSessionStore({ dbPath: ':memory:' });
  try {
    const bundle = await forkFixture(store);
    const first = await store.commitForkBundle(bundle);
    const counts = store.debugCounts();
    const persisted = await store.getSession(first.id);
    assert.deepEqual(await store.commitForkBundle(bundle), persisted);
    assert.deepEqual(store.debugCounts(), counts);
    assert.equal((await store.messages({ sessionID: 'child' }))[0].parts[0].text, 'copied context');
    assert.equal((await store.readTarget({ sessionID: 'child' })).objective, bundle.goal.source.objective);
    assert.equal((await store.listSessionInputs({ sessionID: 'child' })).length, 1);
    assert.equal((await store.sessionEntries({ sessionID: 'parent' }))[0].data.ack.result.sessionId, 'child');
  } finally { store.close(); }
});

test('legacy fork command reuses original child and rejects invalid identity', async () => {
  const store = new SqliteSessionStore({ dbPath: ':memory:' });
  try {
    await store.createSession(session('parent'));
    const metadata = { parentSessionId: 'parent', sourceCommandId: 'legacy-fork', forkTarget: { productTurnId: 'turn', transcriptTurnId: 'turn', orderedMessageIds: [], boundaryMessageId: 'boundary' } };
    const first = await store.createForkedSessionWithMetadata(session('legacy-child', 'parent'), metadata);
    assert.deepEqual(await store.createForkedSessionWithMetadata(session('other-child', 'parent'), metadata), first);
    assert.equal(await store.getSession('other-child'), null);
    await assert.rejects(store.createForkedSessionWithMetadata(session('invalid', 'different-parent'), metadata), /parent/);
  } finally { store.close(); }
});

function sharedFixture(id = 'shared-session') {
  const contextMessage = message(id);
  Object.assign(contextMessage.info, { visibility: 'model-only', source: 'shared_context', metadata: { contextId: 'context-1', sharedContextStatus: 'pending' } });
  return { session: session(id), contextMessage, provenance: { id: `${id}-provenance`, sessionID: id, type: 'v4/shared_context_import', time: { created: 1000, updated: 1000 }, data: { contextId: 'context-1', status: 'pending' } } };
}

test('shared context import and status transition are idempotent and consistent', async () => {
  const store = new SqliteSessionStore({ dbPath: ':memory:' });
  try {
    const bundle = sharedFixture();
    const first = await store.commitSharedContextImportBundle(bundle);
    const counts = store.debugCounts();
    const persisted = await store.getSession(first.id);
    assert.deepEqual(await store.commitSharedContextImportBundle(bundle), persisted);
    assert.deepEqual(store.debugCounts(), counts);
    const base = { sessionID: bundle.session.id, contextId: 'context-1' };
    assert.equal(await store.transitionSharedContextImport({ ...base, expectedStatus: 'pending', status: 'reserved', sourceId: 'input-1' }), true);
    assert.equal(await store.transitionSharedContextImport({ ...base, expectedStatus: 'pending', status: 'attached' }), false);
    assert.equal(await store.transitionSharedContextImport({ ...base, expectedStatus: ['reserved'], status: 'attached' }), true);
    assert.equal((await store.sessionEntries({ sessionID: base.sessionID }))[0].data.status, 'attached');
    assert.equal((await store.messages({ sessionID: base.sessionID }))[0].info.metadata.sharedContextStatus, 'attached');
  } finally { store.close(); }
});

test('shared context write failure rolls back session and message', async () => {
  const store = new SqliteSessionStore({ dbPath: ':memory:' });
  try {
    const bundle = sharedFixture('invalid-shared-session');
    bundle.contextMessage.parts[0].messageID = 'missing-message';
    const before = store.debugCounts();
    await assert.rejects(store.commitSharedContextImportBundle(bundle), /FOREIGN KEY/);
    assert.deepEqual(store.debugCounts(), before);
    assert.equal(await store.getSession(bundle.session.id), null);
  } finally { store.close(); }
});

test('async startup preserves inherited connection and auxiliary store methods', async () => {
  const store = await SqliteSessionStore.openStartup({ dbPath: ':memory:' });
  try {
    await store.createSession(session('history-session'));
    assert.equal(store.getDatabasePath(), ':memory:');
    await store.recordInputHistory({ projectID: 'project', sessionID: 'history-session', text: 'Remember this input', kind: 'prompt' });
    assert.equal((await store.recallPreviousInputHistory({ projectID: 'project' })).text, 'Remember this input');
    const permission = { version: 1, allow: [{ toolName: 'Read' }] };
    await store.saveProjectPermission({ projectID: 'project', permission });
    assert.deepEqual(await store.getProjectPermission('project'), permission);
    store.saveProjectPermissionMode({ projectID: 'project', mode: 'build' });
    assert.equal(store.getProjectPermissionMode('project'), 'build');
  } finally { store.close(); }
});
