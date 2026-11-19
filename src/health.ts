import { App, Modal, TFile } from "obsidian";
import * as fs from "fs";
import type AgentMemoryPlugin from "./main";
import { collectTopics } from "./indexer";

export type IssueLevel = "error" | "warn" | "info";

export interface Issue {
  level: IssueLevel;
  title: string;
  detail: string;
}

const DAY = 86_400_000;

export function checkHealth(plugin: AgentMemoryPlugin): Issue[] {
  const { app, settings } = plugin;
  const issues: Issue[] = [];
  let l0Text = "";

  // 1. 注入层占用
  if (!settings.l0Path) {
    issues.push({
      level: "error",
      title: "没有配置注入层文件",
      detail: "设置 → Agent Memory → 注入层文件，填 agent 每次会话自动读的那个文件的绝对路径",
    });
  } else {
    try {
      l0Text = fs.readFileSync(settings.l0Path, "utf8");
      const n = [...l0Text].length;

      if (settings.maxChars > 0) {
        const ratio = n / settings.maxChars;
        if (ratio > 1) {
          issues.push({
            level: "error",
            title: `注入层超过你设的预警线：${n} / ${settings.maxChars} 字符`,
            detail:
              "注意：这是你自己设的线，不是你平台的真实上限。真实上限要自己测。" +
              "不过既然已经超了，说明该做减法了——把不常用的内容移到主题文件里，只留每次都要的。",
          });
        } else if (ratio > settings.warnRatio) {
          issues.push({
            level: "warn",
            title: `注入层已用 ${Math.round(ratio * 100)}%（按你设的预警线算）`,
            detail: `${n} / ${settings.maxChars} 字符`,
          });
        }
      } else {
        issues.push({
          level: "info",
          title: `注入层 ${n} 字符，还没设预警线`,
          detail:
            "真实上限是 token 数，随平台、版本、模型变化，没有通用值。" +
            "跑一次「写入测量探针」，开个新会话问你的 AI 能不能读到文件最后一行，就能量出来。",
        });
      }
    } catch (err) {
      issues.push({
        level: "error",
        title: "读不到注入层文件",
        detail: (err as Error).message,
      });
    }
  }

  // 2. 主题缺少 trigger
  const { entries, noTrigger } = collectTopics(app, settings.topicsDir);
  if (noTrigger.length) {
    issues.push({
      level: "warn",
      title: `${noTrigger.length} 篇主题没有 trigger，不会出现在索引里`,
      detail: noTrigger.join("、"),
    });
  }

  // 3. 主题过期
  const cutoff = Date.now() - settings.staleDays * DAY;
  const stale: string[] = [];
  for (const e of entries) {
    const f = app.vault.getAbstractFileByPath(e.path);
    if (f instanceof TFile && f.stat.mtime < cutoff) {
      const days = Math.floor((Date.now() - f.stat.mtime) / DAY);
      stale.push(`${f.basename}（${days} 天）`);
    }
  }
  if (stale.length) {
    issues.push({
      level: "info",
      title: `${stale.length} 个主题超过 ${settings.staleDays} 天没更新`,
      detail: stale.join("、"),
    });
  }

  // 4. L0 里引用但已经不存在的文件
  if (l0Text) {
    const missing: string[] = [];
    const re = /`([^`\n]+\.md)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l0Text)) !== null) {
      const rel = m[1].replace(/\\/g, "/").trim();
      if (!rel || rel.startsWith("http")) continue;
      if (!app.vault.getAbstractFileByPath(rel)) missing.push(rel);
    }
    if (missing.length) {
      issues.push({
        level: "warn",
        title: `${missing.length} 个被引用的文件不存在`,
        detail: missing.join("、"),
      });
    }
  }

  if (!issues.length) {
    issues.push({
      level: "info",
      title: "没发现问题",
      detail: "注入层在预算内，主题都有 trigger，引用也都在。",
    });
  }
  return issues;
}

export class HealthModal extends Modal {
  private issues: Issue[];

  constructor(app: App, issues: Issue[]) {
    super(app);
    this.issues = issues;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("agent-memory-health-modal");
    contentEl.createEl("h2", { text: "记忆健康检查" });

    const order: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 };
    const sorted = [...this.issues].sort((a, b) => order[a.level] - order[b.level]);

    for (const it of sorted) {
      const box = contentEl.createDiv({ cls: `agent-memory-issue am-${it.level}` });
      box.createDiv({ text: it.title, cls: "agent-memory-issue-title" });
      box.createDiv({ text: it.detail, cls: "agent-memory-issue-detail" });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
