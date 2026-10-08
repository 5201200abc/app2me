export function readInterfaceTypography(el) {
  const get = (selector) => el.querySelector(selector);
  const measure = (node) => {
    const r = node.getBoundingClientRect(),
      s = getComputedStyle(node);
    return {
      ...r.toJSON(),
      font: s.fontSize,
      weight: s.fontWeight,
      line: s.lineHeight,
      whiteSpace: s.whiteSpace,
      overflow: s.textOverflow,
      color: s.color,
      family: s.fontFamily,
    };
  };
  const titles = [...el.querySelectorAll('[data-task-title-copy="original"]')].map(measure);
  const dates = [...el.querySelectorAll("[data-task-time]")].map(measure);
  const shell = get("[data-prompt-editor-shell]");
  const bar = get("[data-composer-bottom-bar]");
  const add = measure(get("[data-composer-add]")),
    send = measure(get('[data-testid="v4-composer-send"]'));
  const answer = measure(get(".conversation-answer")),
    input = measure(shell);
  return {
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    rootFont: getComputedStyle(document.documentElement).fontSize,
    token: document.documentElement.style.getPropertyValue("--ui-font-size"),
    sidebar: measure(get("[data-typography-sidebar]")),
    body: answer,
    bubble: measure(get(".conversation-user-bubble")),
    title: measure(get('[data-testid="workspace-title"]')),
    meta: measure(get("[data-v4-user-input-meta]")),
    work: measure(get(".conversation-work-summary button")),
    titles,
    dates,
    primary: [
      ...el.querySelectorAll(
        '[data-sidebar-primary-actions] :is([data-size="lg"], [data-testid="task-new-button"])',
      ),
    ].map((row) => {
      const range = document.createRange();
      const text =
        row.querySelector(".truncate") ??
        [...row.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
      range.selectNodeContents(text);
      return { ...measure(row), textLeft: range.getBoundingClientRect().left };
    }),
    actions: (() => {
      const node = get(".conversation-message-actions");
      const buttons = [...node.querySelectorAll("button")].map(measure);
      return { gap: getComputedStyle(node).columnGap, buttons };
    })(),
    input,
    controls: [add, measure(get(".composer-model-trigger")), send],
    insets: [add.left - input.left, input.right - send.right, input.bottom - send.bottom],
    rows: [...el.querySelectorAll("[data-task-item-key]")].map(measure),
    overlaps: [...el.querySelectorAll("[data-task-item-key]")].some((row) => {
      const t = row.querySelector('[data-task-title-copy="original"]').getBoundingClientRect(),
        d = row.querySelector("[data-task-time]").getBoundingClientRect();
      return t.right > d.left + 1;
    }),
    overflow:
      el.scrollWidth > el.clientWidth ||
      bar.scrollWidth > bar.clientWidth ||
      answer.right > get("[data-typography-scroll]").getBoundingClientRect().right,
    paragraphs: [...el.querySelectorAll(".conversation-answer p, .conversation-answer li")].map(
      measure,
    ),
  };
}
