import { Notice, Plugin } from "obsidian";
import * as fs from "fs";
import {
  AgentMemorySettings,
  AgentMemorySettingTab,
  DEFAULT_SETTINGS,
} from "./settings";
import { rebuildIndex } from "./indexer";
import { checkHealth, HealthModal } from "./health";

const PROBE_BEGIN = "<!-- agent-memory:probe:begin -->";
const PROBE_END = "<!-- agent-memory:probe:end -->";

export default class AgentMemoryPlugin extends Plugin {
  settings!: AgentMemorySettings;
  private statusEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new AgentMemorySettingTab(this.app, this));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("agent-memory-status");
    this.statusEl.addEventListener("click", () => this.copyL0Path());

    this.addCommand({
      id: "rebuild-topic-index",
      name: "重建主题索引",
      callback: () => rebuildIndex(this),
    });

    this.addCommand({
      id: "check-memory-health",
      name: "检查记忆健康度",
      callback: () => new HealthModal(this.app, checkHealth(this)).open(),
    });

    this.addCommand({
      id: "refresh-status",
      name: "刷新状态栏占用",
      callback: () => this.updateStatusBar(),
    });

    this.addCommand({
      id: "write-measure-probe",
      name: "写入测量探针（量真实的注入上限）",
      callback: () => this.writeProbe(),
    });

    this.addCommand({
      id: "remove-measure-probe",
      name: "移除测量探针",
      callback: () => this.removeProbe(),
    });

    this.app.workspace.onLayoutReady(() => this.updateStatusBar());

    // 注入层可能被 agent 随时改写，定期重读
    this.registerInterval(
      window.setInterval(() => this.updateStatusBar(), 60_000)
    );
  }

  onunload(): void {
    this.statusEl?.remove();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  updateStatusBar(): void {
    const el = this.statusEl;
    if (!el) return;

    el.removeClass("am-over", "am-warn", "am-ok");

    if (!this.settings.showStatusBar) {
      el.setText("");
      el.hide();
      return;
    }
    el.show();

    if (!this.settings.l0Path) {
      el.setText("Agent Memory · 未配置");
      el.setAttr("aria-label", "点开设置填注入层路径");
      return;
    }

    try {
      const text = fs.readFileSync(this.settings.l0Path, "utf8");
      const n = [...text].length;
      const limit = this.settings.maxChars;

      // 没设预警线：只报字数，不假装知道上限在哪
      if (!limit || limit <= 0) {
        el.setText(`${n.toLocaleString()} 字`);
        el.addClass("am-ok");
        el.setAttr("aria-label", `注入层 ${n} 字符。还没设预警线，点开设置看看怎么测`);
        return;
      }

      const ratio = n / limit;
      const cls = ratio > 1 ? "am-over" : ratio > this.settings.warnRatio ? "am-warn" : "am-ok";

      el.setText(`${n.toLocaleString()} / ${limit.toLocaleString()}`);
      el.addClass(cls);
      el.setAttr(
        "aria-label",
        `注入层已用 ${Math.round(ratio * 100)}%（点击复制路径）`
      );
    } catch {
      el.setText("Agent Memory · 读不到");
      el.addClass("am-over");
      el.setAttr("aria-label", this.settings.l0Path);
    }
  }

  /**
   * 往注入层末尾放一个唯一标记。用户随后开个新会话，问 AI「文件最后一行是什么」：
   * 读到了说明这一行没被截断，没读到说明截断点在它之前。这是唯一不靠猜的测法。
   */
  writeProbe(): void {
    const p = this.settings.l0Path;
    if (!p) {
      new Notice("先配置注入层文件路径");
      return;
    }
    try {
      const text = fs.readFileSync(p, "utf8");
      if (text.includes("agent-memory:probe:begin")) {
        new Notice("已经有探针了，先「移除测量探针」再写新的");
        return;
      }
      const id = Math.random().toString(36).slice(2, 6).toUpperCase();
      const block =
        `\n\n${PROBE_BEGIN}\n` +
        `PROBE-${id} 记忆注入测量点。如果你在会话开头读到了这一行，说明到这里为止没有被截断。\n` +
        `${PROBE_END}\n`;
      fs.writeFileSync(p, text.replace(/\s*$/, "") + block, "utf8");
      new Notice(
        `已写入探针 PROBE-${id}\n\n` +
          `开一个新会话，问你的 AI：文件最后一行写的是什么？\n` +
          `读到 PROBE-${id} → 这段没被截断；没读到 → 截断点在它之前，往回减。\n` +
          `测完记得移除探针，它不该留在记忆里。`,
        20000
      );
      this.updateStatusBar();
    } catch (e) {
      new Notice(`写入失败：${(e as Error).message}`);
    }
  }

  removeProbe(): void {
    const p = this.settings.l0Path;
    if (!p) return;
    try {
      let text = fs.readFileSync(p, "utf8");
      const re = /\n*<!-- agent-memory:probe:begin -->[\s\S]*?<!-- agent-memory:probe:end -->\n*/;
      if (!re.test(text)) {
        new Notice("没有找到探针");
        return;
      }
      text = text.replace(re, "\n");
      fs.writeFileSync(p, text.replace(/\s*$/, "") + "\n", "utf8");
      new Notice("探针已移除");
      this.updateStatusBar();
    } catch (e) {
      new Notice(`移除失败：${(e as Error).message}`);
    }
  }

  async copyL0Path(): Promise<void> {
    const p = this.settings.l0Path;
    if (!p) {
      new Notice("还没配置注入层文件路径");
      return;
    }
    try {
      await navigator.clipboard.writeText(p);
      new Notice(`已复制：${p}`);
    } catch {
      new Notice(p, 10000);
    }
  }
}
