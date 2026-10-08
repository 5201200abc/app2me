export function resolveApp2meReleaseIdentity(
  date = new Date().toISOString().slice(0, 10),
  now = new Date(),
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid app2me release date: ${date}`);
  }
  const [year, month, day] = date.split("-").map(Number);
  const seconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  return {
    releaseName: `app2me-${date}`,
    date,
    // 日期是公开发布名；内部版本只用于 Electron 更新比较，不生成公开语义版本 tag。
    appVersion: `${year}.${month * 100 + day}.${seconds}`,
    windowsBuildVersion: `${year}.${month}.${day}.${now.getUTCHours() * 60 + now.getUTCMinutes()}`,
  };
}
