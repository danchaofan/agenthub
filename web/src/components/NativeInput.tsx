import { useState } from 'react';
import type { PendingInput } from '../../../server/types';
export function NativeInput({
  pending,
  busy,
  answer,
}: {
  pending: PendingInput;
  busy: boolean;
  answer: (option: string, fields?: unknown) => void;
}) {
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const schema = pending.fields as any;
  return (
    <div className="native-input">
      <div className="eyebrow">需要你的输入 · Kimi 原生请求</div>
      <h3>{pending.title}</h3>
      {schema ? (
        Object.entries(schema.properties ?? {}).map(([key, field]: [string, any]) => (
          <label key={key}>
            {field.title ?? key}
            {schema.required?.includes(key) && ' *'}
            {field.description && <span className="muted">{field.description}</span>}
            {field.enum || field.oneOf ? (
              <select
                value={String(fields[key] ?? '')}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
              >
                <option value="">请选择</option>
                {(field.enum ?? field.oneOf.map((v: any) => v.const)).map(
                  (v: string, i: number) => (
                    <option key={v} value={v}>
                      {field.oneOf?.[i]?.title ?? v}
                    </option>
                  ),
                )}
              </select>
            ) : field.type === 'boolean' ? (
              <select
                value={fields[key] === undefined ? '' : String(fields[key])}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    [key]: e.target.value === '' ? undefined : e.target.value === 'true',
                  })
                }
              >
                <option value="">请选择</option>
                <option value="true">是</option>
                <option value="false">否</option>
              </select>
            ) : (
              <input
                value={String(fields[key] ?? '')}
                type={['number', 'integer'].includes(field.type) ? 'number' : 'text'}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    [key]:
                      e.target.value === ''
                        ? undefined
                        : ['number', 'integer'].includes(field.type)
                          ? Number(e.target.value)
                          : e.target.value,
                  })
                }
              />
            )}
          </label>
        ))
      ) : (
        <details>
          <summary>查看请求详情</summary>
          <pre>{pending.detail}</pre>
        </details>
      )}
      <div className="plan-actions">
        {pending.options.map((o) => (
          <button
            key={o.optionId}
            className={
              o.kind?.startsWith('reject') || o.optionId === 'decline' ? 'secondary' : 'primary'
            }
            disabled={busy}
            onClick={() => answer(o.optionId, fields)}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}
