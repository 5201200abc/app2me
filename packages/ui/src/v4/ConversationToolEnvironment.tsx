import { GlmMonochromeIcon } from "@/components/ui/GlmMonochromeIcon.js";
import { useDesktopToolEnvironment } from "@/hooks/useDesktopToolEnvironment.js";

export function ConversationToolEnvironment({ enabled }: { enabled: boolean }) {
  const environment = useDesktopToolEnvironment(enabled);
  if (!environment) return null;
  return (
    <section data-source-tool-environment className="min-w-0">
      <details className="group rounded-md hover:bg-foreground/[0.04]">
        <summary className="flex min-h-11 cursor-pointer items-start gap-2 px-1 py-2 text-ui-caption text-foreground list-none">
          <GlmMonochromeIcon className="mt-0.5 size-4 shrink-0 opacity-80" />
          <span className="min-w-0">
            <span className="block truncate">Mycode App Tools</span>
            <span className="block text-ui-sm text-foreground-subtlest">
              Loaded workspace dependencies once
            </span>
          </span>
        </summary>
        <div className="space-y-2 rounded-lg bg-foreground/[0.04] px-3 py-2 font-mono text-ui-caption text-foreground-subtle break-all">
          <p>
            Git：{environment.gitPath ?? "未检测到"}
            {environment.gitVersion ? ` · ${environment.gitVersion}` : ""}
          </p>
          <p>
            Node.js：{environment.nodePath} · {environment.nodeVersion}
          </p>
          <p>Bundle version：{environment.bundleVersion}</p>
          {environment.bundledPaths.map((path) => (
            <p key={path}>bundled paths：{path}</p>
          ))}
        </div>
      </details>
    </section>
  );
}
