import assert from "node:assert/strict";
import test from "node:test";
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import {
  $createPromptMentionNode,
  PromptMentionNode,
} from "../src/mentions/nodes/PromptMentionNode.js";
import { $getPromptMarkdown } from "../src/mentions/promptSerialization.js";
import {
  $getLeadingGoalCommand,
  $removeLeadingGoalCommand,
} from "../src/prompt-editor/leadingGoalCommand.js";

test("工具栏目标取自原节点；删除仅移除命令与分隔空格，保留正文和文件 mention", () => {
  const editor = createEditor({
    nodes: [PromptMentionNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const goal = $createPromptMentionNode({
        id: "goal",
        category: "commands",
        value: "goal",
        label: "Goal",
        markdown: "/goal",
      });
      const file = $createPromptMentionNode({
        id: "file",
        category: "files",
        value: "a.ts",
        label: "a.ts",
        markdown: "@a.ts",
      });
      $getRoot().append($createParagraphNode().append(goal, $createTextNode("  写代码 "), file));
      assert.equal($getLeadingGoalCommand()?.getKey(), goal.getKey());
      assert.equal($getPromptMarkdown(), "/goal  写代码 @a.ts");
      assert.equal($removeLeadingGoalCommand(goal.getKey()), true);
      assert.equal($getPromptMarkdown(), "写代码 @a.ts");
      assert.equal(file.isAttached(), true);
      assert.equal($removeLeadingGoalCommand(goal.getKey()), false);
    },
    { discrete: true },
  );
});

test("正文中的 goal 和其他命令不投影，过期 key 不能删除新目标", () => {
  const editor = createEditor({
    nodes: [PromptMentionNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const goal = $createPromptMentionNode({
        id: "goal",
        category: "commands",
        value: "/goal",
        label: "Goal",
        markdown: "/goal",
      });
      const paragraph = $createParagraphNode().append($createTextNode("正文 "), goal);
      $getRoot().append(paragraph);
      assert.equal($getLeadingGoalCommand(), null);
      assert.equal($removeLeadingGoalCommand(goal.getKey()), false);
      paragraph.getFirstChild()?.remove();
      assert.equal($getLeadingGoalCommand()?.getKey(), goal.getKey());
      assert.equal($removeLeadingGoalCommand("stale-key"), false);
      goal.remove();
      paragraph.append(
        $createPromptMentionNode({
          id: "workflow",
          category: "commands",
          value: "workflow",
          label: "Workflow",
          markdown: "/workflow",
        }),
      );
      assert.equal($getLeadingGoalCommand(), null);
    },
    { discrete: true },
  );
});
