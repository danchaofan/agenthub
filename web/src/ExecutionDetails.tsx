import { useEffect, useRef, useState } from 'react';
import type { Log, Task } from '../../server/types';

const stages: Record<string, string> = {
  planning: '拆解分工',
  executing: '执行步骤',
  reviewing: '独立审查',
  reworking: '自动返工',
  summarizing: '汇总',
};
const states: Record<string, string> = {
  running: '运行中',
  pending: '等待执行',
  in_progress: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};
const time = (at: string) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
function legacyTitle(log: Log) {
  return log.content
    .split('\n')[0]
    .replace(/(?: · (?:pending|in_progress|completed|failed))+$/, '');
}
function toolState(log: Log) {
  return (
    log.tool?.status ??
    log.content
      .split('\n')[0]
      .split(' · ')
      .reverse()
      .find((s) => ['pending', 'in_progress', 'completed', 'failed'].includes(s))
  );
}
function belongs(log: Log, session: Log) {
  return log.invocationId
    ? log.invocationId === session.id
    : !!session.sessionId && log.sessionId === session.sessionId;
}

export function ExecutionDetails({
  task,
  round,
  initialSession,
  close,
}: {
  task: Task;
  round: number;
  initialSession: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(initialSession),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [limit, setLimit] = useState(50);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
    };
  }, []);
  useEffect(() => {
    setLimit(50);
  }, [selected, query, filter]);
  const logs = task.logs.filter((l) => l.round === round);
  const sessions = logs.filter((l) => l.kind === 'message');
  const session = sessions.find((l) => l.id === selected);
  const scoped = session ? logs.filter((l) => belongs(l, session)) : logs;
  const tools = scoped.filter((l) => l.kind === 'tool');
  const visible = tools.filter(
    (l) =>
      (filter === 'all' || toolState(l) === filter) &&
      `${l.name} ${l.content} ${JSON.stringify(l.tool ?? {})}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const execution = session?.execution;
  const elapsed =
    session && execution?.finishedAt
      ? ((Date.parse(execution.finishedAt) - Date.parse(session.at)) / 1000).toFixed(1) + ' 秒'
      : undefined;
  const download = () => {
    const blob = new Blob(
      [JSON.stringify({ taskId: task.id, round, session: session ?? null, logs: scoped }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agenthub-${task.id}-round-${round}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <dialog
      ref={dialog}
      className="execution-dialog"
      aria-label="Coding agent 执行详情"
      onCancel={close}
    >
      <header className="execution-header">
        <div>
          <strong>执行详情</strong>
          <span>
            第 {round} 轮 · {task.title}
          </span>
        </div>
        <button className="secondary" onClick={download}>
          导出日志
        </button>
        <button className="secondary" onClick={close}>
          关闭详情 ×
        </button>
      </header>
      <div className="execution-layout">
        <nav className="execution-sessions" aria-label="执行会话">
          <button className={!session ? 'active' : ''} onClick={() => setSelected('')}>
            <strong>本轮全部活动</strong>
            <span>
              {sessions.length} 个会话 · {logs.filter((l) => l.kind === 'tool').length} 条工具活动
            </span>
          </button>
          {sessions.map((s, i) => (
            <button
              key={s.id}
              className={s.id === selected ? 'active' : ''}
              onClick={() => setSelected(s.id)}
            >
              <strong>
                {i + 1}. {s.name}
                <small>{states[s.execution?.status ?? ''] ?? '历史记录'}</small>
              </strong>
              <span>
                {stages[s.execution?.stage ?? ''] ?? '独立会话'} · {time(s.at)}
              </span>
              <span>
                {logs.filter((l) => l.kind === 'tool' && belongs(l, s)).length} 条工具活动
              </span>
            </button>
          ))}
        </nav>
        <section className="execution-content">
          {session ? (
            <div className="execution-meta">
              <h2>
                {session.name} · {stages[execution?.stage ?? ''] ?? '独立会话'}
              </h2>
              <p>
                {execution?.model ??
                  task.config.profiles.find((p) => p.name === session.name)?.model}{' '}
                · thinking{' '}
                {execution?.thinking ||
                  task.config.profiles.find((p) => p.name === session.name)?.thinking ||
                  '默认'}
              </p>
              <p>
                会话 ID <code>{session.sessionId || '连接中…'}</code>
              </p>
              <p>
                {states[execution?.status ?? ''] ?? '历史记录'} · 开始 {time(session.at)}
                {execution?.finishedAt && ` · 结束 ${time(execution.finishedAt)}`}
                {elapsed && ` · 耗时 ${elapsed}`}
              </p>
              {execution?.error && <p className="warning-text">{execution.error}</p>}
              {execution?.prompt && (
                <details>
                  <summary>发送给 agent 的完整指令</summary>
                  <pre>{execution.prompt}</pre>
                </details>
              )}
              {scoped
                .filter((l) => l.kind === 'thought')
                .map((l) => (
                  <details key={l.id}>
                    <summary>Agent 返回的思考内容</summary>
                    <pre>{l.content}</pre>
                  </details>
                ))}
              <details>
                <summary>Agent 回复</summary>
                <pre>{session.content || '尚未收到回复，工具活动会在下方实时更新。'}</pre>
              </details>
              {!execution && (
                <p className="execution-note">
                  旧记录保留了当时采集的工具日志；完整指令、参数和耗时从新执行开始记录。
                </p>
              )}
            </div>
          ) : (
            <div className="execution-meta">
              <h2>本轮工具活动</h2>
              <p>选择左侧会话可查看该 agent 的指令与回复。运行中的活动会自动更新。</p>
            </div>
          )}
          <div className="execution-filters">
            <input
              aria-label="搜索执行日志"
              placeholder="搜索命令、文件、输出…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="工具状态筛选"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">全部状态</option>
              <option value="in_progress">执行中</option>
              <option value="completed">已完成</option>
              <option value="failed">失败</option>
              <option value="pending">等待执行</option>
            </select>
            <span>{visible.length} 条</span>
          </div>
          <div className="execution-timeline">
            {visible.slice(0, limit).map((l) => {
              const activity = l.tool,
                status = toolState(l);
              return (
                <details className="execution-tool" key={l.id}>
                  <summary>
                    <span className={'execution-state ' + (status ?? '')}>
                      {states[status ?? ''] ?? '活动'}
                    </span>
                    <strong>{activity?.title ?? legacyTitle(l)}</strong>
                    <span>
                      {l.name} · {time(l.at)}
                    </span>
                  </summary>
                  <div className="execution-tool-body">
                    {activity ? (
                      <>
                        <div className="execution-tool-info">
                          {activity.kind && <span>类型 {activity.kind}</span>}
                          <span>工具 ID {activity.id}</span>
                          <span>更新 {time(activity.updatedAt)}</span>
                        </div>
                        {activity.locations?.map((p, i) => (
                          <p key={i} className="execution-location">
                            {p.path}
                            {p.line !== undefined && `:${p.line}`}
                          </p>
                        ))}
                        {activity.input !== undefined && (
                          <>
                            <h3>调用参数</h3>
                            <pre>{activity.input}</pre>
                          </>
                        )}
                        {activity.details && (
                          <>
                            <h3>工具输出 / 文件差异</h3>
                            <pre>{activity.details}</pre>
                          </>
                        )}
                        {activity.output !== undefined && activity.output !== activity.details && (
                          <>
                            <h3>原始结果</h3>
                            <pre>{activity.output}</pre>
                          </>
                        )}
                        {activity.input === undefined &&
                          !activity.details &&
                          activity.output === undefined && (
                            <p className="execution-note">Agent 尚未返回工具参数或输出。</p>
                          )}
                      </>
                    ) : (
                      <>
                        <h3>历史工具日志</h3>
                        <pre>{l.content}</pre>
                      </>
                    )}
                  </div>
                </details>
              );
            })}
            {!visible.length && (
              <p className="execution-note">
                {tools.length
                  ? '没有符合筛选条件的活动。'
                  : '尚无工具活动；收到 agent 的工具调用后会显示在这里。'}
              </p>
            )}
            {visible.length > limit && (
              <button className="secondary" onClick={() => setLimit(limit + 50)}>
                再显示 50 条（剩余 {visible.length - limit} 条）
              </button>
            )}
          </div>
        </section>
      </div>
    </dialog>
  );
}
