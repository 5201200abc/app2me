import type { MyCodeSessionStateSnapshot } from "@mycode/shared";
import type {
  MyCodeSessionWorkspaceTarget,
  MyCodeTaskTarget,
} from "#src/mycode-session/mycodeSession.js";

function getWorkspaceKey(target: MyCodeSessionWorkspaceTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

function getSessionScopedKey(target: MyCodeTaskTarget): string {
  return `${getWorkspaceKey(target)}\0${target.sessionId}`;
}

export function createMyCodeDeferredDraftRegistry() {
  const sessionKeys = new Set<string>();

  return {
    remember(params: MyCodeSessionWorkspaceTarget, snapshot: MyCodeSessionStateSnapshot): void {
      sessionKeys.add(
        getSessionScopedKey({
          workspacePath: snapshot.session.workspace.workspacePath,
          workspaceIdentity:
            snapshot.session.workspace.workspaceIdentity ?? params.workspaceIdentity,
          sessionId: snapshot.session.sessionId,
        }),
      );
    },

    has(target: MyCodeTaskTarget): boolean {
      return sessionKeys.has(getSessionScopedKey(target));
    },

    forget(target: MyCodeTaskTarget): void {
      sessionKeys.delete(getSessionScopedKey(target));
    },
  };
}
