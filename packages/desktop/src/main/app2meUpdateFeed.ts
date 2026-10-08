export const APP2ME_RELEASE_FEED_URL =
  "https://github.com/5201200abc/app2me/releases/download/latest";

export function resolveApp2meUpdateChannel(arch: string): string {
  if (arch !== "x64" && arch !== "arm64")
    throw new Error(`Unsupported update architecture: ${arch}`);
  return `latest-${arch}`;
}

export function usesApp2meReleaseFeed(isPackaged: boolean, flavor: string): boolean {
  return isPackaged && flavor === "production";
}

export function shouldEnableDesktopUpdates(
  isPackaged: boolean,
  flavor: string,
  hasDevelopmentFeedOverride: boolean,
): boolean {
  return (
    flavor === "production" &&
    (usesApp2meReleaseFeed(isPackaged, flavor) || hasDevelopmentFeedOverride)
  );
}
