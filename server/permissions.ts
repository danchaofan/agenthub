// Conservative classifier for the read-only leader/reviewer sessions. This is a
// protocol guard, not an operating-system sandbox for the CLI.
export function requestedCommand(tool: any): string | undefined {
  const raw = tool?.rawInput;
  if (typeof raw?.command === 'string') return raw.command;
  if (typeof raw?.cmd === 'string') return raw.cmd;
  const text = (tool?.content ?? []).map((c: any) => c.content?.text ?? c.text ?? '').join('\n');
  return text.match(/(?:Running|command):\s*([\s\S]*)/i)?.[1]?.trim();
}
export function isReadOnlyTool(tool: any): boolean {
  const title = String(tool?.title ?? tool?.kind ?? '');
  if (/^(Read|ReadFile|read_file|Glob|Grep|ListDirectory|read)$/i.test(title)) return true;
  const command = requestedCommand(tool);
  if (!command) return false;
  // Exclude shell evaluation, redirections, substitutions and destructive find options.
  if (
    /[`>$\n\r]/.test(command) ||
    /\|\||(^|[^&])&([^&]|$)/.test(command) ||
    /(?:-delete|-exec|-ok|-fprint|-fls|--output|--pre\b)/.test(command)
  )
    return false;
  return command.split(/&&|;|\|/).every((part) => {
    const text = part.trim();
    return (
      /^(?:ls|pwd|cat|head|tail|wc|stat)\b/.test(text) ||
      /^(?:rg|grep)\b/.test(text) ||
      /^find\s/.test(text) ||
      /^sed\s+-n\s+['"]?\d+(?:,\d+)?p['"]?\s+[^;]+$/.test(text) ||
      (/^git\s+(?:status|diff|log|show|ls-files)\b/.test(text) &&
        !/--ext-diff|--textconv|--no-index/.test(text))
    );
  });
}
