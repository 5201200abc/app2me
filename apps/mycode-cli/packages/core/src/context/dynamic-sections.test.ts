import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDynamicBehaviorSection } from "./dynamic-sections.js";

test("Agent 系统行为包含同会话权限和应用复用以及无 emoji 规则",()=>{
  const section=buildDynamicBehaviorSection();
  assert.equal(section.injectionTarget,"system");
  assert.match(section.content,/same conversation.*check_permissions and list_apps/);
  assert.match(section.content,/Recheck only after an operation fails/);
  assert.match(section.content,/Do not use emoji in any reply or tool-output summary/);
  assert.equal(section.chars,section.content.length);
});
