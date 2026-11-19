# Agent Memory

**Keep the memory file your AI agent reads in shape.**

An Obsidian plugin for people who give their agent a long-term memory by putting it in Markdown.
It generates the topic index, watches the character budget, and tells you when the memory rots.

[中文说明](README.zh-CN.md) · MIT · Obsidian ≥ 1.4.0 · desktop only

---

## The problem

You put your memory in Obsidian. The agent has a file it reads at the start of every session.
It works — until the file grows to 6,000 characters, half of it silently stops arriving,
and nobody tells you.

Three things go wrong quietly:

1. **The injected file outgrows the platform's limit.** Content past the cutoff is simply
   dropped. No warning, no error. The agent answers as if that part never existed.
2. **The topic index drifts.** You add `AI记忆/主题/docker.md`, forget to add a row to the
   index table in the injected file, and the topic becomes invisible forever.
3. **Nobody audits the memory.** Stale topics, files referenced but deleted, topics with no
   trigger words — all invisible until something breaks.

This plugin addresses exactly those three, from inside Obsidian.

## Why "tell the agent to read your notes" never works

We tried it first. On 2026-11-10 we wrote this into the agent's startup file:

> Every session, before anything else, read these 4 files: the index, the status file, the
> collaboration notes, the facts table.

**One week later: zero executions. Not once.**

The reason is cost accounting, and it is rational. Reading 4 files costs 4 tool calls and
roughly 30 KB of context. Meanwhile the auto-injected file already carries the red lines, the
machine facts, the preferences — everything except the *status* line. The marginal value of
reading is small; the cost is visible. So the model skips it, every single time.

**A rule that never runs is worse than no rule.** It teaches the model that rules in this
project are soft, and the next rule you write inherits that.

The conclusion that shaped this design:

> Stop asking the agent to fetch its memory. Put the memory where it cannot avoid seeing it.

## There is a budget, and nobody tells you where it ends

Injected context is not unlimited. Past some point the tail is dropped silently — no warning,
no error. The agent answers as if that part never existed.

**We don't ship a number for it, because there isn't a portable one:**

- The real limit is counted in **tokens**, not characters. Character count is only a proxy, and
  the ratio shifts with your language mix.
- It changes with platform, version, and model context window.
- **Our first guess was wrong.** We originally estimated ≈4,300 characters on WorkBuddy
  (2026-11) from a single observation. A later, careful measurement on the same setup put the
  real cutoff at **4,013 characters** — found by comparing the injected text against the source
  file and locating the last line that actually arrived. The error was 7%. If we hadn't measured,
  we'd have kept shipping documents that silently lost their last section.

**So the plugin ships a probe instead of a number.**

1. Run **Write measurement probe** — appends a unique `PROBE-XXXX` line to the end of your
   injected file.
2. Start a new session and ask your agent: *"What is the last line of the file you read?"*
3. If it quotes the probe back, that line survived. If it doesn't, the cutoff sits above it —
   trim and retry.
4. Run **Remove measurement probe**, then put the character count you settled on into settings.

The status bar then shows `used / your-line`, turning orange at 90% and red past 100%.
**With no line configured it just shows the current count** — inventing a default would be
telling you something we don't know.

## Three layers, one of which is guaranteed

| Layer | Where | When it loads | Reliable? |
| --- | --- | --- | --- |
| **L0** | the injected file (`MEMORY.md`, `AGENTS.md`, …) | every session, by the platform | **yes** — no model decision involved |
| **L1** | `AI记忆/主题/*.md` | on demand, when a trigger word matches | mostly — depends on a cheap lookup |
| **L2** | project notes, chat archives | only when something specific is asked | no — requires real digging |

Only L0 is guaranteed, because injection requires no consent. Everything else has to be cheap
enough that it actually happens. That is why L1 entries need **trigger words** and why the index
table must stay short.

## What this plugin does

### 1. Generate the topic index

Scans a folder of topic notes, reads `trigger` from each file's frontmatter, and writes a lookup
table into your injected file — **only between two markers**, never touching anything else.

```yaml
---
trigger: docker / compose / container / 容器
summary: How Docker is set up on this machine
---
```

Becomes:

| 提到这些词 | 读这个 |
| --- | --- |
| docker / compose / container / 容器 | `AI记忆/主题/docker.md` |

Add a topic file, run **Rebuild topic index**, done. No more editing two places.

### 2. Watch the character budget

Status bar shows `used / limit`. Click it to copy the absolute path of the injected file.

### 3. Audit the memory

**Check memory health** reports:

- injected file over budget (or close to it)
- topic notes with no `trigger` — those never appear in the index
- topics not updated in N days
- paths referenced in the injected file that no longer exist

## What it does not do

Being explicit, so you do not expect the wrong things:

- **It cannot make your agent read the memory.** Only the platform's injection can do that.
  If your agent has no injected file, this plugin has nothing to manage.
- **It cannot archive your chats.** That needs to run at the agent/OS level, not inside
  Obsidian. Pair it with a separate script if you want that.
- **It does not sync across devices.** Use Obsidian Sync, git, or whatever you already use.
- **It writes to one file outside the vault** — the injected file you configure. Nothing else.

## Install

### From source (for now)

```bash
git clone https://github.com/kldcg/obsidian-agent-memory
cd obsidian-agent-memory
npm install
npm run build
```

Copy `manifest.json`, `main.js`, `styles.css` into `<your-vault>/.obsidian/plugins/agent-memory/`,
then enable **Agent Memory** in Settings → Community plugins.

### Community plugin browser

Not listed yet. Planned once the version stabilises.

## Setup

1. **Settings → Agent Memory → 注入层文件**
   Click **自动检测** to look for common locations, or paste the absolute path yourself.
   Typical values:
   - WorkBuddy — `~/.workbuddy/user-<uuid>-personal/MEMORY.md`
   - Claude Code — `~/.claude/CLAUDE.md` or a project `AGENTS.md`
   - Cursor — `~/.cursorrules` or a project `AGENTS.md`
2. **注入层预警线** — your own measured character count, or `0` to just display the count
   without judging it. See the probe workflow above.
3. **主题目录** — where your topic notes live, e.g. `AI记忆/主题`.
4. Put the marker pair somewhere in the injected file:

```markdown
<!-- agent-memory:index:begin -->
<!-- agent-memory:index:end -->
```

If the markers are missing, the index is appended to the end of the file and you get a hint to
move it where you want. **Your other content is never modified.**

## A minimal working layout

```
your-vault/
├── AI记忆/
│   ├── 主题/
│   │   ├── docker.md          # trigger: docker / container / 容器
│   │   └── printer.md         # trigger: 打印 / 打印机
│   └── 会话状态.md             # detailed history, read on demand
└── 项目/
    └── 2026-11-17 migration.md
```

And the injected file (`MEMORY.md`), kept under the limit:

```markdown
## Status
- Working on: …

<!-- agent-memory:index:begin -->
| 提到这些词 | 读这个 |
| --- | --- |
| docker / container / 容器 | `AI记忆/主题/docker.md` |
<!-- agent-memory:index:end -->

## Rules
- …
```

## Privacy

- Reads: the injected file path you configured, and Markdown files inside your vault.
- Writes: the injected file (index block only) and this plugin's own settings file.
- Network: **none**. No telemetry, no update checks, no remote calls.
- The plugin never reads your vault's other files unless the health check needs to verify a
  path referenced in the injected file.

`isDesktopOnly: true` — reading a file outside the vault requires Node's `fs`, which is not
available on mobile.

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # typecheck + bundle
```

`main.js` is a build artifact and is gitignored; release builds attach it to a GitHub release,
as the community plugin guidelines expect.

## License

MIT
