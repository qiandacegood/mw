/**
 * 小程序模块依赖提取规则。
 *
 * build-miniprogram.mjs 与 check-miniprogram-imports.mjs 必须使用同一套规则，
 * 否则会出现「构建复制了 A、检查却按 B 判定缺失」的分歧。
 *
 * 注意：这里刻意使用带后行断言的正则，避免把源码字符串里的字面量
 * （例如 tslib 内部的 `__rest(r, ["from","to","direction"])`）误判成模块说明符。
 */

const ESM_FROM = /(?<![\w"'`$])from\s*["']([^"']+)["']/g;
const REQUIRE_CALL = /(?<![\w"'`$])require\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT = /(?<![\w"'`$])import\(\s*["']([^"']+)["']\s*\)/g;
const SIDE_EFFECT_IMPORT = /(?:^|[;{}\n])\s*import\s+["']([^"']+)["']/gm;
const WXSS_IMPORT = /@import\s+["']([^"']+)["']/g;
const WXML_SRC = /<(?:import|include|wxs)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g;

export const MP_FILE_EXTENSIONS = [".js", ".json", ".wxml", ".wxss", ".wxs"];

/**
 * @param {string} source 文件文本
 * @param {string} ext 文件扩展名，如 ".js"
 * @returns {string[]} 去重后的模块说明符
 */
export function specsOfSource(source, ext) {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const found = new Set();
  const add = (spec) => {
    if (typeof spec !== "string") return;
    const trimmed = spec.trim();
    if (!trimmed) return;
    if (trimmed.includes("://")) return;
    found.add(trimmed);
  };

  if (ext === ".js") {
    for (const pattern of [ESM_FROM, REQUIRE_CALL, DYNAMIC_IMPORT, SIDE_EFFECT_IMPORT]) {
      for (const match of text.matchAll(pattern)) add(match[1]);
    }
    return [...found];
  }

  if (ext === ".json") {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    const using = parsed && typeof parsed === "object" ? parsed.usingComponents : null;
    if (using && typeof using === "object") {
      for (const value of Object.values(using)) add(value);
    }
    return [...found];
  }

  if (ext === ".wxss") {
    for (const match of text.matchAll(WXSS_IMPORT)) add(match[1]);
    return [...found];
  }

  if (ext === ".wxml") {
    for (const match of text.matchAll(WXML_SRC)) add(match[1]);
    return [...found];
  }

  return [...found];
}
