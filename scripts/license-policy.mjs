const permissive =
  /^(MIT|MIT-0|ISC|BSD-2-Clause|BSD-3-Clause|BSD-4-Clause|0BSD|Unlicense|Apache-2\.0|Zlib|WTFPL|Artistic-2\.0|BlueOak-1\.0\.0|CC0-1\.0|CC-BY-4\.0|CC-BY-3\.0|BSD|Python-2\.0)$/i;
const severity = [
  "green",
  "yellow-weak",
  "yellow-lgpl",
  "yellow-cc",
  "review",
  "unresolved",
  "missing",
  "red-gpl",
  "red-agpl",
  "red-semiopen",
  "red-nc",
];

function identifier(value) {
  if (permissive.test(value)) return "green";
  if (/^AGPL/i.test(value)) return "red-agpl";
  if (/^LGPL/i.test(value)) return "yellow-lgpl";
  if (/^GPL/i.test(value)) return "red-gpl";
  if (/^(MPL|EPL|CDDL)/i.test(value)) return "yellow-weak";
  if (/^(BUSL|BSL|Elastic|SSPL|PolyForm|FSL|CAL-1)/i.test(value)) return "red-semiopen";
  if (/^CC-BY-NC/i.test(value)) return "red-nc";
  if (/^CC-BY-(ND|SA)/i.test(value)) return "yellow-cc";
  return "review";
}

export function classifyLicense(raw) {
  const text = raw.trim();
  if (!text || /^(?:\(missing\)|missing)$/i.test(text)) return "missing";
  if (/^(?:UNLICENSED|SEE LICEN[CS]E IN|UNKNOWN|N\/A)/i.test(text)) return "unresolved";
  const tokens = text.match(/\(|\)|[A-Za-z0-9][A-Za-z0-9.+-]*/g) ?? [];
  if (tokens.join("") !== text.replace(/\s/g, "")) return "review";
  let cursor = 0;
  const combine = (a, b, choose) => severity[choose(severity.indexOf(a), severity.indexOf(b))];
  function atom() {
    if (tokens[cursor] === "(") {
      cursor++;
      const value = or();
      if (tokens[cursor++] !== ")") throw new Error("Unclosed license expression");
      return value;
    }
    const value = tokens[cursor++];
    if (!value || ["AND", "OR", "WITH", ")"].includes(value))
      throw new Error("Missing license identifier");
    const result = identifier(value);
    if (tokens[cursor] === "WITH") {
      cursor += 2;
      // 未逐项复核的例外不能让许可证约束自动消失。
      return "review";
    }
    return result;
  }
  function and() {
    let value = atom();
    while (tokens[cursor] === "AND") {
      cursor++;
      value = combine(value, atom(), Math.max);
    }
    return value;
  }
  function or() {
    let value = and();
    while (tokens[cursor] === "OR") {
      cursor++;
      value = combine(value, and(), Math.min);
    }
    return value;
  }
  try {
    const result = or();
    return cursor === tokens.length ? result : "review";
  } catch {
    return "review";
  }
}
