export function ReviewMessage({ text }: { text: string }) {
  let value: any;
  try {
    const json = text
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');
    value = JSON.parse(json);
  } catch {}
  if (typeof value?.passed !== 'boolean')
    return (
      <div className="text-content">{text || <span className="thinking">正在独立审查…</span>}</div>
    );
  return (
    <div className={'review-card ' + (value.passed ? 'passed' : '')}>
      <strong>{value.passed ? '审查通过' : '审查发现问题'}</strong>
      <p>{value.summary}</p>
      {value.issues?.map((issue: string, i: number) => (
        <p key={i}>· {issue}</p>
      ))}
    </div>
  );
}
