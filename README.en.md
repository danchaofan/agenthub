# Agenthub

**A local workbench for a configurable team of coding agents.**

[中文](README.md) · [Contributing](CONTRIBUTING.md) · [Architecture](docs/architecture.md) · [MIT License](LICENSE)

Configure a leader, workers and a reviewer. The leader proposes a plan; you approve or edit it before workers execute sequentially. An independent session reviews the result, with at most one automatic rework per round. The leader summarizes the delivery, and your feedback starts a new round with another approval.

The first release integrates **Kimi Code CLI**. Other agents and a Mac desktop package are planned. The current product is a local HTTP service and a desktop-style web workbench.

![Workbench](docs/images/workbench.png)

Screenshots use browser-test fixtures, not live model output or model benchmarks.

## Features

- Local Kimi discovery and dynamic model/thinking choices.
- Editable global profiles and rule-based recommendations using available models and shared quota.
- Immutable task configuration snapshots, approved plans, sequential execution, independent review, one rework per round and continued feedback.
- Live execution details: tool calls, commands, parameters, output, file diffs, session history, search, status filters and JSON export.
- Local SQLite persistence and explicit recovery after interrupted execution.

## Quick start

Requirements: **Node.js 22.13+** (24 LTS recommended), a browser, and an installed, authenticated [Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli). Live integration was verified with Kimi CLI 2.1.1; other versions must support the required ACP capabilities.

```bash
git clone https://github.com/danchaofan/agenthub.git
cd agenthub
npm ci
npm run build
npm run dashboard
```

Open **http://127.0.0.1:4317**. Configure your global team, submit a task for an existing project directory, review the plan and approve it. Use execution details and file previews to inspect progress; submit feedback after delivery.

```bash
npm run status
npm run stop
npm run dev
```

`dashboard` runs the service in the background. Repeating the command returns the running service's address. There is currently no npm distribution or native installer. macOS is the primary development platform; CI is configured for macOS and Linux. Windows is unverified.

## Permissions and data

Workers use Kimi's Ask When Needed mode (ACP `auto`) by default; manual approval is configurable. Native permission requests and forms appear in the web UI. Leader and reviewer sessions use a read-only tool allowlist. These restrictions are not an OS sandbox: the CLI retains the local user's privileges and environment configuration.

Cancelling preserves existing file changes. Restarted tasks are marked interrupted rather than replayed. Each new feedback round requires plan approval. Roles use independent sessions but share their account's quota.

Runtime state belongs in ignored `.agenthub/`; local evidence belongs in ignored `artifacts/`. Kimi credentials stay in Kimi's own home directory; Agenthub reads the existing token for quota queries without storing it or returning it to the UI. Prompts, tool output and exports can still contain sensitive project data. See [SECURITY.md](SECURITY.md).

Key environment variables:

| Variable             | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `AGENTHUB_PORT`      | Loopback service port, default `4317`                    |
| `AGENTHUB_DATA_DIR`  | Runtime directory, default `.agenthub/`                  |
| `AGENTHUB_NODE`      | Node executable for the optional shell wrapper           |
| `AGENTHUB_CHROME`    | Optional browser executable for tests/capture            |
| `KIMI_CODE_HOME`     | Existing Kimi configuration/credential directory         |
| `KIMI_CODE_BASE_URL` | Quota API base, default `https://api.kimi.com/coding/v1` |
| `AGENTHUB_URL`       | Service address for opt-in live/capture scripts          |
| `AGENTHUB_TASK_ID`   | Existing task for live continuation/history capture      |

Environment variables are passed by the shell; `.env` is not loaded automatically.

## Development and verification

```bash
npm ci
npm run dev
npm run format
npm run check
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run test:example
npm run test:example-browser
```

Unit, ACP and browser tests use isolated fixtures and do not need account credentials or consume model quota. macOS tests can use installed Chrome; other platforms use Playwright Chromium or `AGENTHUB_CHROME`.

Opt-in live acceptance consumes Kimi quota and modifies the isolated `.agenthub/acceptance-project/` directory:

```bash
npm run dashboard
npm run test:live
```

Do not run live acceptance in CI. Evidence is written to ignored `artifacts/`. See [testing notes](docs/testing.md) and [contribution guidelines](CONTRIBUTING.md).

## Limits

Only Kimi is integrated. Recommendations are rules, not cross-model evaluations or learned cost predictions. Execution details are ACP activity records, not a raw PTY terminal replay. Text previews have file count/size limits and are not backups. The service has no remote/multi-user authentication mode. Historical records only show fields collected at the time; new sessions record prompts, parameters and timing.

## Acknowledgments

Inspired by [botmux](https://github.com/deepcoldy/botmux) and [Orca](https://github.com/stablyai/orca). Kimi CLI is installed independently and is not bundled. Agenthub is [MIT-licensed](LICENSE); dependencies and reference projects retain their own licenses. See [THIRD_PARTY.md](THIRD_PARTY.md).
