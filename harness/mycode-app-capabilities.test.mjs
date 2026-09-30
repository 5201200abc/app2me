import assert from "node:assert/strict";
import { test } from "node:test";
import { createAttachmentFacade } from "../apps/mycode-cli/packages/bootstrap/src/app/app-attachment-facade.ts";
import { createDynamicWorkflowFacade } from "../apps/mycode-cli/packages/bootstrap/src/app/app-dynamic-workflow-facade.ts";
import { createResumePreparation } from "../apps/mycode-cli/packages/bootstrap/src/app/app-resume-preparation.ts";

const traceContext = { traceId: "trace-app-test", sessionId: "session-app-test" };
const attachmentFacade = ({ sessionStore, artifactStore, fileSystemPort } = {}) =>
  createAttachmentFacade({
    sessionId: "session-app-test",
    traceContext,
    sessionStore: sessionStore ?? { messageWithParts: async () => null },
    artifactStore: artifactStore ?? {},
    fileSystemPort: fileSystemPort ?? {},
  });

test("attachment reads prefer the persisted immutable artifact over a changed source path", async () => {
  const reads = [];
  const facade = attachmentFacade({
    sessionStore: {
      messageWithParts: async (input) => {
        assert.deepEqual(input, { sessionID: "session-app-test", messageID: "message-one" });
        return {
          parts: [
            {
              type: "file",
              mime: "image/png",
              url: "/deleted/source.png",
              metadata: { artifactUri: "mycode-artifact://saved" },
            },
          ],
        };
      },
    },
    artifactStore: {
      readToolResultArtifact: async (input) => {
        reads.push(input);
        return { content: "data:image/png;base64,aGVsbG8=" };
      },
    },
    fileSystemPort: { readBinaryFile: async () => assert.fail("Mutable source must not be read") },
  });
  const value = await facade.readPromptAttachment({
    ref: "/changed/source.png",
    mime: "text/plain",
    messageId: "message-one",
    attachmentIndex: 0,
    maxBytes: 5,
  });
  assert.equal(Buffer.from(value.bytes).toString(), "hello");
  assert.equal(value.mediaType, "image/png");
  assert.equal(reads[0].uri, "mycode-artifact://saved");
  await assert.rejects(
    facade.readPromptAttachment({ ref: "mycode-artifact://saved", mime: "image/png", maxBytes: 4 }),
  );
});

test("an attachment part not yet persisted still reads through the session filesystem", async () => {
  const reads = [];
  const facade = attachmentFacade({
    sessionStore: { messageWithParts: async () => ({ parts: [] }) },
    fileSystemPort: {
      readBinaryFile: async (input) => {
        reads.push(input);
        return { content: new Uint8Array([1, 2]) };
      },
    },
  });
  const value = await facade.readPromptAttachment({
    ref: "/remote/pending.bin",
    mime: "application/octet-stream",
    messageId: "message-one",
    attachmentIndex: 0,
    maxBytes: 20,
  });
  assert.deepEqual([...value.bytes], [1, 2]);
  assert.deepEqual(reads, [{ path: "/remote/pending.bin", maxBytes: 20, trace: traceContext }]);
});

test("video preview failure falls back to artifact chunks without exposing the old path", async () => {
  const facade = attachmentFacade({
    sessionStore: {
      messageWithParts: async () => ({
        parts: [
          {
            type: "file",
            mime: "video/mp4",
            url: "/old/movie.mp4",
            metadata: { artifactUri: "mycode-artifact://movie" },
          },
        ],
      }),
    },
    artifactStore: {
      ensureMediaAttachmentPath: async () => {
        throw new Error("Cache unavailable");
      },
    },
  });
  assert.deepEqual(
    await facade.resolvePromptAttachmentPreviewSource({
      ref: "/old/movie.mp4",
      mime: "video/mp4",
      messageId: "message-one",
      attachmentIndex: 0,
    }),
    { kind: "chunked" },
  );
});

test("workflow capabilities stay absent as a group when the required port is incomplete", () => {
  const deps = {
    getRuntime: () => assert.fail("Factory must remain lazy"),
    traceContext,
    prepareUserExecutionBoundary: async () => {},
  };
  assert.deepEqual(createDynamicWorkflowFacade({ ...deps, dynamicWorkflowRunPort: undefined }), {});
  const partial = createDynamicWorkflowFacade({
    ...deps,
    dynamicWorkflowRunPort: {
      listEvents: async () => [],
      listArtifacts: async () => [],
      listArtifactItems: async () => [],
    },
  });
  assert.equal(typeof partial.listDynamicWorkflowRunEvents, "function");
  for (const key of [
    "listDynamicWorkflowRunArtifacts",
    "listDynamicWorkflowRunArtifactItems",
    "readDynamicWorkflowRunArtifact",
  ])
    assert.equal(key in partial, false);
});

test("workflow launch waits for the shared user boundary and successful resume is tracked", async () => {
  const order = [];
  const runtime = {
    startSavedWorkflowRun: async (input) => {
      order.push("launch");
      assert.equal(input.traceContext, traceContext);
      return "started";
    },
    trackResumedDynamicWorkflowRun: async (input) => {
      order.push("track");
      assert.deepEqual(input, {
        runId: "run-new",
        toolCallId: "tool-new",
        name: "Resumed",
        traceContext,
      });
    },
  };
  const facade = createDynamicWorkflowFacade({
    traceContext,
    getRuntime: () => runtime,
    prepareUserExecutionBoundary: async () => {
      order.push("prepare");
      await Promise.resolve();
      order.push("prepared");
    },
    dynamicWorkflowRunPort: {
      listEvents: async () => [],
      resume: async () => {
        order.push("resume");
        return { ok: true, runId: "run-new", toolCallId: "tool-new" };
      },
    },
  });
  assert.equal(await facade.startSavedWorkflow({ name: "Example" }), "started");
  await facade.resumeWorkflowRun({ workId: "work-old", name: "Resumed" });
  assert.deepEqual(order, ["prepare", "prepared", "launch", "resume", "track"]);
});

test("multiple first user boundaries share a single asynchronous shell selection", async () => {
  let selections = 0;
  const initialized = [];
  const selected = { shell: "/bin/zsh", source: "test" };
  const { prepareUserExecutionBoundary } = createResumePreparation({
    options: {
      resume: false,
      resolveInitialBashShellSelection: async () => {
        selections++;
        await Promise.resolve();
        return selected;
      },
    },
    sessionId: "session-app-test",
    traceContext,
    logger: {},
    sessionStore: {},
    getRuntime: () => ({
      initializeSessionShellEnvironmentIfNeeded: (selection) => initialized.push(selection),
    }),
  });
  await Promise.all([prepareUserExecutionBoundary(), prepareUserExecutionBoundary()]);
  await prepareUserExecutionBoundary();
  assert.equal(selections, 1);
  assert.deepEqual(initialized, [selected, selected, selected]);
});
