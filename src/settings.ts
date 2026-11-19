import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type AgentMemoryPlugin from "./main";

export interface AgentMemorySettings {
  /** 注入层文件的绝对路径（agent 每次会话自动读的那个文件） */
  l0Path: string;
  /**
   * 预警线，不是平台限制。0 = 未设定，只显示字数不判红黄。
   * 真实边界是 token 数，随平台/版本/模型变化，没有通用值，得用户自己测。
   */
  maxChars: number;
  /** 主题目录，vault 相对路径 */
  topicsDir: string;
  /** 达到多少比例开始警告 */
  warnRatio: number;
  /** 主题多少天没更新算过期 */
  staleDays: number;
  /** 是否在状态栏显示占用 */
  showStatusBar: boolean;
}

export const DEFAULT_SETTINGS: AgentMemorySettings = {
  l0Path: "",
  maxChars: 0,
  topicsDir: "AI记忆/主题",
  warnRatio: 0.9,
  staleDays: 90,
  showStatusBar: true,
};

/**
 * 在常见位置自动找注入层文件。
 * 只读常见的固定路径，不递归扫描用户目录。
 */
export function detectL0Path(): string | null {
  const home = os.homedir();
  const candidates: string[] = [];

  // WorkBuddy：~/.workbuddy/user-<uuid>-personal/MEMORY.md
  const wbRoot = path.join(home, ".workbuddy");
  if (fs.existsSync(wbRoot)) {
    try {
      for (const name of fs.readdirSync(wbRoot)) {
        if (!/^user-.*-personal$/.test(name)) continue;
        candidates.push(path.join(wbRoot, name, "MEMORY.md"));
      }
    } catch {
      /* 目录不可读就算了 */
    }
  }

  // 其他常见 agent 的记忆文件
  candidates.push(
    path.join(home, ".claude", "CLAUDE.md"),
    path.join(home, "CLAUDE.md"),
    path.join(home, "AGENTS.md")
  );

  const existing = candidates.filter((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
  if (!existing.length) return null;

  // 有多个就取最近修改的那个
  existing.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  return existing[0];
}

export class AgentMemorySettingTab extends PluginSettingTab {
  plugin: AgentMemoryPlugin;

  constructor(app: App, plugin: AgentMemoryPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Agent Memory" });

    containerEl.createEl("p", {
      text:
        "这个插件不替你的 agent 存记忆，它维护 agent 读的那几个文件：生成主题索引、" +
        "盯着注入层别被截断、检查记忆有没有烂掉。",
      cls: "setting-item-description",
    });

    // ---- 注入层路径 ----
    new Setting(containerEl)
      .setName("注入层文件（L0）")
      .setDesc(
        "agent 每次会话自动读的那个文件，绝对路径。例如 " +
          "~/.workbuddy/user-xxxx-personal/MEMORY.md，或项目里的 AGENTS.md。" +
          "留空则所有功能停用。"
      )
      .addText((t) => {
        t.setPlaceholder("/home/you/.workbuddy/user-xxx-personal/MEMORY.md")
          .setValue(this.plugin.settings.l0Path)
          .onChange(async (v) => {
            this.plugin.settings.l0Path = v.trim();
            await this.plugin.saveSettings();
          });
        t.inputEl.addClass("agent-memory-wide-input");
      })
      .addButton((b) =>
        b.setButtonText("自动检测").onClick(async () => {
          const found = detectL0Path();
          if (!found) {
            new Notice("没找到常见的注入层文件，请手动填写绝对路径");
            return;
          }
          this.plugin.settings.l0Path = found;
          await this.plugin.saveSettings();
          this.display();
          new Notice(`已填入：${found}`);
        })
      )
      .addButton((b) =>
        b.setButtonText("检查").onClick(() => {
          const p = this.plugin.settings.l0Path;
          if (!p) {
            new Notice("还没填路径");
            return;
          }
          try {
            const st = fs.statSync(p);
            const text = fs.readFileSync(p, "utf8");
            new Notice(
              `文件存在，${[...text].length} 字符，最后修改 ${st.mtime.toLocaleString()}`
            );
          } catch (e) {
            new Notice(`读不到：${(e as Error).message}`);
          }
        })
      );

    // ---- 预警线 ----
    new Setting(containerEl)
      .setName("注入层预警线（字符）")
      .setDesc(
        "这只是你自己设的预警线，不是平台限制。真实边界是 token 数，随平台、版本、模型变化，" +
          "没有通用值——填 0 表示不预警，只显示当前字数。" +
          "测法：用命令「写入测量探针」，开个新会话问你的 AI 能不能读到文件最后一行。"
      )
      .addText((t) => {
        t.setValue(String(this.plugin.settings.maxChars)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.maxChars = n;
            await this.plugin.saveSettings();
            this.plugin.updateStatusBar();
          }
        });
        t.inputEl.type = "number";
      });

    // ---- 主题目录 ----
    new Setting(containerEl)
      .setName("主题目录")
      .setDesc(
        "放各个主题笔记的目录（vault 相对路径）。每个文件用 frontmatter 的 trigger 声明" +
          "「说到哪些词就该读我」，本插件据此生成索引表。"
      )
      .addText((t) =>
        t
          .setPlaceholder("AI记忆/主题")
          .setValue(this.plugin.settings.topicsDir)
          .onChange(async (v) => {
            this.plugin.settings.topicsDir = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // ---- 警告阈值 ----
    new Setting(containerEl)
      .setName("警告阈值")
      .setDesc("用到上限的多少比例时，状态栏变黄。默认 0.9。")
      .addSlider((s) =>
        s
          .setLimits(0.5, 1, 0.05)
          .setValue(this.plugin.settings.warnRatio)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.warnRatio = v;
            await this.plugin.saveSettings();
            this.plugin.updateStatusBar();
          })
      );

    // ---- 过期天数 ----
    new Setting(containerEl)
      .setName("主题过期天数")
      .setDesc("主题笔记这么久没更新，会在健康检查里被标出来。")
      .addText((t) => {
        t.setValue(String(this.plugin.settings.staleDays)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.staleDays = n;
            await this.plugin.saveSettings();
          }
        });
        t.inputEl.type = "number";
      });

    // ---- 状态栏开关 ----
    new Setting(containerEl)
      .setName("在状态栏显示占用")
      .setDesc("右下角显示「已用 / 上限」。点一下复制 L0 路径。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showStatusBar).onChange(async (v) => {
          this.plugin.settings.showStatusBar = v;
          await this.plugin.saveSettings();
          this.plugin.updateStatusBar();
        })
      );

    // ---- 索引块标记说明 ----
    containerEl.createEl("h3", { text: "索引块怎么写" });
    const pre = containerEl.createEl("pre");
    pre.createEl("code", {
      text:
        "<!-- agent-memory:index:begin -->\n" +
        "（这段会被自动生成的内容覆盖）\n" +
        "<!-- agent-memory:index:end -->",
    });
    containerEl.createEl("p", {
      text:
        "在 L0 文件里放一对这样的标记，重建索引时只替换标记之间的内容，" +
        "其他内容一个字都不动。没有标记时会追加到文件末尾。",
      cls: "setting-item-description",
    });
  }
}
