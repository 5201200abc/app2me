import assert from "node:assert/strict";
import { test } from "node:test";
import { createRemovedFeedbackService } from "../src/feedback/feedback.js";

test("retired feedback RPCs reject submissions and uploads", async () => {
  const service = createRemovedFeedbackService();

  await assert.rejects(service.create({} as never), /Feedback integration has been removed/);
  await assert.rejects(service.list(), /Feedback integration has been removed/);
  await assert.rejects(
    service.uploadAttachmentData("ticket", "image", {} as never),
    /Feedback integration has been removed/,
  );
});
