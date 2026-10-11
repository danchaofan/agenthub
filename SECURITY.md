# Security

Agenthub currently supports local use. It binds to `127.0.0.1`, validates Host and Origin, and requires a private local token for service shutdown. There is no multi-user authentication or remote deployment mode; keep the service on loopback.

Coding agents can modify project files and run commands with your local user's privileges after plan confirmation. Read-only roles use a restricted tool allowlist; this is not an operating-system sandbox. Use a separate project directory when evaluating untrusted tasks.

Kimi credentials stay in Kimi's existing home directory. Agenthub reads the existing access token for quota queries and does not send it to the web UI or persist it in its own database. Agent-provided output, file previews, prompts and exported logs can nevertheless contain sensitive project data; they are not automatically redacted.

Runtime state belongs in `.agenthub/`; local test evidence belongs in `artifacts/`. Both are ignored by Git. Do not attach either directory, raw session exports or credentials to a public issue.

For a suspected vulnerability, use GitHub's private vulnerability reporting on this repository when available. If private reporting is unavailable, open an issue requesting a private contact without including exploit details, credentials or project data. This early release has no guaranteed security response time.
