import { useState } from "react";
import { Globe2 } from "@/components/icons/tabler.js";

export function ConversationSiteIcon({ href }: { href: string }) {
  const [failed, setFailed] = useState(false);
  let origin: string | undefined;
  try {
    const url = new URL(href);
    if (url.protocol === "https:" && !/^(localhost|127\.|\[::1\])/.test(url.hostname))
      origin = url.origin;
  } catch {
    /* 非网页引用使用线性地球图标。 */
  }
  return origin && !failed ? (
    <img
      className="conversation-site-icon"
      src={`${origin}/favicon.ico`}
      alt=""
      onError={() => setFailed(true)}
    />
  ) : (
    <Globe2 aria-hidden className="conversation-site-icon" strokeWidth={1.5} />
  );
}
