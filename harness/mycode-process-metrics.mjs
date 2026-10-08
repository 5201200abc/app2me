export function collectProcessMetrics(el) {
  const rows = [...el.querySelectorAll("[data-type-rows] [data-process-row]")];
  const metrics = rows.map((row) => {
    const icon = row.querySelector("[data-process-icon] svg"),
      copy = row.querySelector("[data-process-copy]"),
      arrow = row.querySelector("[data-process-chevron]"),
      title = copy.querySelector(
        "[data-reasoning-label],[data-file-verb],[data-process-title],.tool-summary-kind-label",
      );
    const b = row.getBoundingClientRect(),
      c = copy.getBoundingClientRect(),
      i = icon.getBoundingClientRect();
    return {
      height: b.height,
      y: b.y,
      x: c.x,
      textOffset: c.x - b.x,
      iconOffset: i.x - b.x,
      iconY: i.y + i.height / 2,
      lineHeight: getComputedStyle(copy).lineHeight,
      gap: getComputedStyle(row).columnGap,
      iconWidth: i.width,
      iconHeight: i.height,
      center: i.x + i.width / 2,
      stroke: getComputedStyle(icon).strokeWidth,
      size: getComputedStyle(title).fontSize,
      weight: getComputedStyle(title).fontWeight,
      color: getComputedStyle(title).color,
      arrowWidth: arrow?.getBoundingClientRect().width,
      arrowGap: arrow
        ? arrow.getBoundingClientRect().x -
          arrow.previousElementSibling.getBoundingClientRect().right
        : null,
    };
  });
  const body = el.querySelector(".conversation-answer"),
    stats = [
      ...el.querySelectorAll(
        "[data-reasoning-duration],[data-tool-diff-count],[data-process-stat]",
      ),
    ].map((node) => ({
      size: getComputedStyle(node).fontSize,
      weight: getComputedStyle(node).fontWeight,
    }));
  const boxes = [400, 401, 402, 403, 404, 405].map((id) =>
    el.querySelector(`[data-row-id="${id}"]`).getBoundingClientRect(),
  );
  const group = el.querySelector('[data-tool-layout-variant="operations"]').getBoundingClientRect();
  const ch = el.querySelector("[data-inventory-change]"),
    cs = getComputedStyle(ch),
    canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  const rgb = (color) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const ctitle = ch.children[1],
    plus = ch.querySelector("[data-inventory-added]");
  const edit = el.querySelector('[data-row-id="402"]');
  const diff = edit.querySelector("[data-tool-diff-count]");
  const step = el.querySelector('[data-row-id="403"]');
  return {
    statisticGaps: {
      file:
        diff.getBoundingClientRect().x - diff.previousElementSibling.getBoundingClientRect().right,
      numbers:
        diff.children[1].getBoundingClientRect().x - diff.children[0].getBoundingClientRect().right,
      step:
        step.querySelector("[data-process-stat]").getBoundingClientRect().x -
        step.querySelector("[data-process-title]").getBoundingClientRect().right,
      reasoning:
        el.querySelector('[data-row-id="401"] [data-process-stat]').getBoundingClientRect().x -
        el.querySelector('[data-row-id="401"] [data-reasoning-label]').getBoundingClientRect()
          .right,
    },
    metrics,
    stats,
    bodySize: getComputedStyle(body).fontSize,
    bodyText: body.textContent,
    gaps: [
      boxes[1].y - boxes[0].bottom,
      boxes[2].y - boxes[1].bottom,
      boxes[3].y - boxes[2].bottom,
      group.y - boxes[3].bottom,
      boxes[4].y - group.bottom,
      boxes[5].y - boxes[4].bottom,
    ],
    change: {
      title: getComputedStyle(ctitle).fontSize,
      plusSize: getComputedStyle(plus).fontSize,
      font: getComputedStyle(ctitle).fontFamily,
      plusFont: getComputedStyle(plus).fontFamily,
      height: ch.getBoundingClientRect().height,
      border: cs.borderBottomWidth,
      plus: rgb(getComputedStyle(plus).color),
      minus: rgb(getComputedStyle(ch.querySelector("[data-inventory-removed]")).color),
      bg: rgb(cs.getPropertyValue("--color-background")),
    },
  };
}
