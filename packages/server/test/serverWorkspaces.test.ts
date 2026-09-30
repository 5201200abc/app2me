import assert from "node:assert/strict";
import test from "node:test";
import { resolveServerWorkspaces } from "../src/serverWorkspaces.ts";

test("a server without an explicitly configured workspace starts with no projects", () => {
  assert.deepEqual(resolveServerWorkspaces(undefined, undefined), []);
  assert.deepEqual(resolveServerWorkspaces(undefined, "  "), []);
});

test("an explicit empty list takes precedence over the environment", () => {
  assert.deepEqual(resolveServerWorkspaces([], "/example/project"), []);
});

test("explicit projects retain their identity rather than being reconstructed from a path", () => {
  const projects = [{ path: "/example/project", label: "Example", workspaceIdentity: "remote:example" }];
  assert.equal(resolveServerWorkspaces(projects, "/another/project"), projects);
});

test("an explicitly configured project remains available without becoming a UI selection", () => {
  assert.deepEqual(resolveServerWorkspaces(undefined, " /example/project "), [
    { path: "/example/project", label: "project" },
  ]);
});
