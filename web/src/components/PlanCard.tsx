import { useEffect, useState } from 'react';
import type { Plan, Profile } from '../../../server/types';
import { Icon } from './Icon';
export function PlanCard({
  plan,
  profiles,
  confirm,
  busy,
}: {
  plan: Plan;
  profiles: Profile[];
  confirm?: (plan: Plan) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(plan);
  useEffect(() => {
    setDraft(plan);
    setEditing(false);
  }, [JSON.stringify(plan)]);
  return (
    <div className="plan-card">
      <div className="card-heading">
        <span className="mini-avatar leader">领</span>
        <div>
          <strong>领队分工</strong>
          <span>{plan.steps.length} 个步骤 · 顺序执行</span>
        </div>
        {confirm && <span className="awaiting-badge">等待你确认</span>}
      </div>
      <p>{plan.summary}</p>
      <div className="plan-steps">
        {draft.steps.map((step, i) => (
          <div className="plan-step" key={step.id}>
            <span className="step-number">{i + 1}</span>
            <div>
              {editing ? (
                <>
                  <input
                    aria-label={`步骤 ${i + 1} 标题`}
                    value={step.title}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        steps: draft.steps.map((s, n) =>
                          n === i ? { ...s, title: e.target.value } : s,
                        ),
                      })
                    }
                  />
                  <select
                    value={step.profileId}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        steps: draft.steps.map((s, n) =>
                          n === i ? { ...s, profileId: e.target.value } : s,
                        ),
                      })
                    }
                  >
                    {profiles
                      .filter((p) => p.role === 'worker')
                      .map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <textarea
                    aria-label={`步骤 ${i + 1} 指令`}
                    value={step.instruction}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        steps: draft.steps.map((s, n) =>
                          n === i ? { ...s, instruction: e.target.value } : s,
                        ),
                      })
                    }
                  />
                </>
              ) : (
                <>
                  <strong>
                    {step.title}
                    <span>{profiles.find((p) => p.id === step.profileId)?.name}</span>
                  </strong>
                  <p>{step.instruction}</p>
                </>
              )}
              <ul>
                {step.acceptance.map((a, n) => (
                  <li key={n}>{a}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
      {confirm && (
        <div className="plan-actions">
          <button className="secondary" onClick={() => setEditing(!editing)}>
            {editing ? '完成编辑' : '编辑分工'}
          </button>
          <button className="primary" disabled={busy} onClick={() => confirm(draft)}>
            <Icon name="check" />
            确认分工并执行
          </button>
        </div>
      )}
    </div>
  );
}
