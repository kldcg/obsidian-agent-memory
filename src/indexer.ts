import { App, normalizePath, Notice } from "obsidian";
import * as fs from "fs";
import type AgentMemoryPlugin from "./main";

export const INDEX_BEGIN = "<!-- agent-memory:index:begin -->";
export const INDEX_END = "<!-- agent-memory:index:end -->";

export interface IndexEntry {
  trigger: string;
  path: string;
  summary?: string;
}

/**
 * 扫主题目录，把每个文件的 frontmatter.trigger 收成一行。
 * trigger 可以写成字符串（"iPhone / 手机 / 刷课"）或数组（["iPhone","刷课"]）。
 */
export function collectTopics(
  app: App,
  topicsDir: string
): { entries: IndexEntry[]; noTrigger: string[] } {
  const dir = normalizePath(topicsDir).replace(/\/+$/, "");
  if (!dir) return { entries: [], noTrigger: [] };

  const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(dir + "/"));
  const entries: IndexEntry[] = [];
  const noTrigger: string[] = [];

  for (const f of files) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    const raw = fm?.trigger;
    if (raw === undefined || raw === null || raw === "") {
      noTrigger.push(f.basename);
      continue;
    }
    const label = Array.isArray(raw) ? raw.join(" / ") : String(raw);
    entries.push({
      trigger: label.replace(/\s*\|\s*/g, " / ").trim(),
      path: f.path,
      summary: fm?.summary,
    });
  }

  entries.sort((a, b) => a.trigger.localeCompare(b.trigger, "zh"));
  noTrigger.sort((a, b) => a.localeCompare(b, "zh"));
  return { entries, noTrigger };
}

export function buildTable(entries: IndexEntry[]): string {
  const lines = ["| 提到这些词 | 读这个 |", "| --- | --- |"];
  for (const e of entries) {
    // 表格里的竖线会把列切断
    const label = e.trigger.replace(/\|/g, "／");
    lines.push(`| ${label} | \`${e.path}\` |`);
  }
  return lines.join("\n");
}

/**
 * 只替换标记之间的内容。没有标记就追加到末尾，绝不改动其他文字。
 */
export function writeIndexBlock(
  l0Path: string,
  table: string
): { mode: "replaced" | "appended" } {
  const text = fs.readFileSync(l0Path, "utf8");
  const b = text.indexOf(INDEX_BEGIN);
  const e = text.indexOf(INDEX_END);

  if (b >= 0 && e > b) {
    const head = text.slice(0, b + INDEX_BEGIN.length);
    const tail = text.slice(e);
    fs.writeFileSync(l0Path, `${head}\n${table}\n${tail}`, "utf8");
    return { mode: "replaced" };
  }

  const block = `\n\n${INDEX_BEGIN}\n${table}\n${INDEX_END}\n`;
  fs.writeFileSync(l0Path, text.replace(/\s*$/, "") + block, "utf8");
  return { mode: "appended" };
}

export function rebuildIndex(plugin: AgentMemoryPlugin): void {
  const { app, settings } = plugin;

  if (!settings.l0Path) {
    new Notice("先在设置里填「注入层文件」的绝对路径");
    return;
  }

  const { entries, noTrigger } = collectTopics(app, settings.topicsDir);

  if (!entries.length) {
    new Notice(
      `主题目录里没有找到带 trigger 的笔记（目录：${settings.topicsDir}）。` +
        `在笔记的 frontmatter 里加一行 trigger: 描述触发词即可。`,
      9000
    );
    return;
  }

  try {
    const { mode } = writeIndexBlock(settings.l0Path, buildTable(entries));
    const parts = [`索引已更新：${entries.length} 个主题`];
    if (noTrigger.length) parts.push(`${noTrigger.length} 篇缺 trigger 已跳过`);
    if (mode === "appended") parts.push("首次写入，已追加到文件末尾，建议把标记移到合适位置");
    new Notice(parts.join("；"), 9000);
    plugin.updateStatusBar();
  } catch (err) {
    new Notice(`写入失败：${(err as Error).message}`, 9000);
  }
}
