# Contributing

Agenthub is an early local workbench. Small, focused pull requests are welcome. Discuss new agent adapters or workflow changes in an issue before implementing a large change.

## Development

Use Node.js 22.13 or newer (24 LTS recommended):

```bash
npm ci
npm run dev
```

The web interface and HTTP service run together at `http://127.0.0.1:4317`. Unit and browser tests use fixtures; they do not require Kimi credentials or consume model quota. Install a browser with `npx playwright install chromium`, or set `AGENTHUB_CHROME` to an installed Chrome/Chromium executable.

Before submitting:

```bash
npm run format
npm run check
npm run build
npm test
npm run test:browser
npm run test:example
npm run test:example-browser
```

CI runs the checks on macOS and Linux with Node.js 22 and 24. Live Kimi acceptance is a separate, explicit opt-in command; never run it in CI or claim fixture results as model results.

## Code boundaries

- `server/engine.ts` owns planning, confirmation, sequential execution, review, rework and feedback.
- `server/acp.ts` implements Kimi's ACP adapter. Implement `AgentRunner` for a new adapter and preserve native permissions, cancellation and independent sessions.
- `server/resources.ts` discovers runtime/model options and queries quota. Unknown data must stay unknown; an unavailable quota must not become zero.
- `web/src/pages/` holds configuration/resource screens; `web/src/components/` holds reusable UI; `App.tsx` assembles the workbench.

Preserve configuration snapshots, confirmation before worker execution, the one-rework-per-round limit, and cancellation without deleting already-written files. Add tests for changed behavior. Keep UI text in Chinese until a separate localization layer is introduced.

Do not commit `.agenthub/`, credentials, environment files, local agent transcripts, task exports, upstream source archives or test traces. `npm run check:release` checks candidate files for local paths and high-confidence secrets; it is a useful guard, not a complete secret detector. Use sanitized fixtures when reporting bugs.

Contributions are distributed under the project's [MIT license](LICENSE).
