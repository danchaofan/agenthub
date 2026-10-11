import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useState, useRef } from 'react';
import type { Task } from '../../server/types';
import { api, type Bootstrap } from './lib/api';
import { labels, roles, initialPrompt } from './lib/labels';
import { Icon } from './components/Icon';
import { PlanCard } from './components/PlanCard';
import { NativeInput } from './components/NativeInput';
import { ReviewMessage } from './components/ReviewMessage';
import { Team } from './pages/Team';
import { Resources } from './pages/Resources';
import { ExecutionDetails } from './ExecutionDetails';
export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null),
    [view, setView] = useState('work'),
    [selected, setSelected] = useState<string | null>(() =>
      new URLSearchParams(location.search).get('task'),
    ),
    [task, setTask] = useState<Task | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [input, setInput] = useState(''),
    [path, setPath] = useState(''),
    [panel, setPanel] = useState(true),
    [artifact, setArtifact] = useState<string | null>(null),
    [roundIndex, setRoundIndex] = useState(-1),
    [executionSession, setExecutionSession] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setSelected(null);
        setTask(null);
        setView('work');
        setInput('');
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const refresh = async () => {
    const data = await api('/bootstrap');
    setBoot(data);
    if (selectedRef.current) {
      const t = await api('/tasks/' + selectedRef.current);
      if (selectedRef.current === t.id) setTask(t);
    }
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const stream = new EventSource('/api/events');
    stream.addEventListener('change', () => void refresh().catch((e) => setError(e.message)));
    return () => stream.close();
  }, []);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (selected) query.set('task', selected);
    else query.delete('task');
    history.replaceState(null, '', location.pathname + (query.size ? '?' + query.toString() : ''));
    setTask(null);
    setRoundIndex(-1);
    setArtifact(null);
    setExecutionSession(null);
    if (selected)
      void api('/tasks/' + selected)
        .then((t) => {
          if (selectedRef.current === t.id) setTask(t);
        })
        .catch((e) => setError(e.message));
  }, [selected]);
  useEffect(() => {
    if (boot && !path) setPath(boot.acceptancePath);
  }, [boot?.acceptancePath]);
  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = () =>
    act(async () => {
      if (!input.trim()) return;
      const result = task
        ? await api(`/tasks/${task.id}/feedback`, 'POST', { instruction: input })
        : await api('/tasks', 'POST', { projectPath: path, instruction: input });
      setSelected(result.id);
      setInput('');
      setRoundIndex(-1);
    });
  const round = task?.rounds[roundIndex < 0 ? task.rounds.length - 1 : roundIndex];
  const running =
    task &&
    ['planning', 'executing', 'reviewing', 'reworking', 'summarizing'].includes(task.status);
  const canFeedback = task && !running;
  if (!boot) return <div className="loading">正在连接本地工作台…{error && <p>{error}</p>}</div>;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            Agenthub<span>你的本地 AI 战队</span>
          </div>
          <span className="version">α</span>
        </div>
        <button
          className="new-task"
          onClick={() => {
            setSelected(null);
            setTask(null);
            setView('work');
            setInput('');
          }}
        >
          <Icon name="plus" />
          新任务<span>⌘ N</span>
        </button>
        <div className="sidebar-title">
          工作空间<span>{boot.tasks.length}</span>
        </div>
        <nav className="task-list">
          {boot.tasks.length ? (
            boot.tasks.map((t) => (
              <button
                key={t.id}
                className={'task-item ' + (selected === t.id && view === 'work' ? 'selected' : '')}
                onClick={() => {
                  setSelected(t.id);
                  setView('work');
                }}
              >
                <Icon name="chat" />
                <div>
                  <strong>{t.title}</strong>
                  <span>
                    <i className={'dot ' + t.status} />
                    {labels[t.status]} · 第 {t.rounds} 轮
                  </span>
                </div>
              </button>
            ))
          ) : (
            <div className="empty-history">
              从一个真实任务开始。
              <br />
              每一轮分工与交付都会留在这里。
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className={view === 'team' ? 'selected' : ''} onClick={() => setView('team')}>
            <Icon name="grid" />
            全局战队{!boot.config && <span className="tiny-badge">待配置</span>}
          </button>
          <button
            className={view === 'resources' ? 'selected' : ''}
            onClick={() => setView('resources')}
          >
            <Icon name="settings" />
            模型与额度
          </button>
          <div className="local-status">
            <i className="dot completed" />
            本地服务已连接<span>Kimi · MVP</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb">
            个人工作空间 <span>/</span>{' '}
            {view === 'team'
              ? '全局战队'
              : view === 'resources'
                ? '模型与额度'
                : task
                  ? task.title
                  : '新任务'}
          </div>
          <div className="header-right">
            {task && view === 'work' && (
              <>
                <span className="status-pill">
                  <i className={'dot ' + task.status} />
                  {labels[task.status]}
                </span>
                <button
                  className="icon-button"
                  aria-label="切换详情面板"
                  onClick={() => setPanel(!panel)}
                >
                  <Icon name="panel" />
                </button>
              </>
            )}
            <span className="avatar">我</span>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setError('')}>×</button>
          </div>
        )}
        {view === 'team' || (!boot.config && view === 'work') ? (
          <Team boot={boot} act={act} busy={busy} onSaved={() => setView('work')} />
        ) : view === 'resources' ? (
          <Resources boot={boot} act={act} busy={busy} />
        ) : (
          <div className="work-layout">
            <section className="conversation">
              <div className="feed">
                {!task ? (
                  <div className="welcome">
                    <div className="eyebrow">从想法到交付</div>
                    <h1>
                      让你的战队，
                      <br />
                      <span>一起完成下一件事。</span>
                    </h1>
                    <p>
                      领队先分析分工，你确认后再执行。
                      <br />
                      实现、审查、反馈，都在同一个工作空间。
                    </p>
                    <div className="workflow-strip">
                      <span>拆解</span>
                      <b>→</b>
                      <span>你确认</span>
                      <b>→</b>
                      <span>执行</span>
                      <b>→</b>
                      <span>审查与交付</span>
                    </div>
                    <button
                      className="starter-card"
                      onClick={() => {
                        setInput(initialPrompt);
                        setPath(boot.acceptancePath);
                      }}
                    >
                      <div className="starter-icon">
                        <Icon name="check" />
                      </div>
                      <div>
                        <strong>跑通第一个真实闭环</strong>
                        <span>构建一个可持久化的任务列表，含自动测试</span>
                      </div>
                      <span>↗</span>
                    </button>
                    <div className="note">
                      已连接 Kimi · 全局配置 v{boot.config?.version} · 确认分工后执行
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="task-heading">
                      <div className="eyebrow">任务工作台</div>
                      <h1>{task.title}</h1>
                      <div className="project-label">
                        <Icon name="folder" />
                        {task.projectPath}
                      </div>
                      <div className="round-tabs">
                        {task.rounds.map((r, i) => (
                          <button
                            key={r.number}
                            className={round?.number === r.number ? 'active' : ''}
                            onClick={() => {
                              setRoundIndex(i);
                              setArtifact(null);
                              setExecutionSession(null);
                            }}
                          >
                            第 {r.number} 轮 {r.review && (r.review.passed ? '✓' : '· 待改进')}
                          </button>
                        ))}
                      </div>
                      <button className="execution-entry" onClick={() => setExecutionSession('')}>
                        查看执行详情 <span>命令 · 文件读写 · 工具输出 ↗</span>
                      </button>
                    </div>
                    {round && (
                      <>
                        <div className="message user-message">
                          <div className="message-label">
                            <span className="mini-avatar">我</span>本轮需求
                          </div>
                          <div className="text-content">{round.instruction}</div>
                        </div>
                        {round.plan && (
                          <PlanCard
                            plan={round.plan}
                            profiles={task.config.profiles}
                            confirm={
                              task.status === 'awaiting_confirmation' &&
                              round.number === task.rounds.length
                                ? (plan) =>
                                    act(() =>
                                      api(`/tasks/${task.id}/confirm`, 'POST', {
                                        round: round.number,
                                        plan,
                                      }),
                                    )
                                : undefined
                            }
                            busy={busy}
                          />
                        )}
                        {task.logs
                          .filter(
                            (log) =>
                              log.round === round.number &&
                              !(
                                log.role === 'leader' &&
                                round.plan &&
                                log.id ===
                                  task.logs.find(
                                    (l) => l.round === round.number && l.role === 'leader',
                                  )?.id
                              ) &&
                              log.kind !== 'tool' &&
                              log.kind !== 'thought',
                          )
                          .map((log) => (
                            <div className="message" key={log.id}>
                              <div className="message-label">
                                <span className={'mini-avatar ' + log.role}>
                                  {log.name.slice(0, 1)}
                                </span>
                                {log.name}
                                <span className="muted">{roles[log.role]}</span>
                                {log.sessionId && (
                                  <button
                                    className="session-tag session-link"
                                    title={log.sessionId}
                                    onClick={() => setExecutionSession(log.id)}
                                  >
                                    查看执行 ↗
                                  </button>
                                )}
                              </div>
                              {log.role === 'reviewer' ? (
                                <ReviewMessage text={log.content} />
                              ) : (
                                <div className="text-content markdown">
                                  {log.content ? (
                                    <Markdown remarkPlugins={[remarkGfm]}>{log.content}</Markdown>
                                  ) : (
                                    <span className="thinking">正在思考与检查项目…</span>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}

                        {task.error && <div className="warning-card">{task.error}</div>}
                        {round.summary && (
                          <div className="delivery-footer">
                            <Icon name="check" />
                            <span>
                              本轮汇总已生成
                              {round.review && !round.review.passed && ' · 仍有未解决的审查问题'}
                              。可以继续反馈，开启下一轮。
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
                {task?.pendingInputs.map((p) => (
                  <NativeInput
                    key={p.id}
                    pending={p}
                    busy={busy}
                    answer={(optionId, fields) =>
                      act(() =>
                        api(`/tasks/${task.id}/input`, 'POST', { inputId: p.id, optionId, fields }),
                      )
                    }
                  />
                ))}
              </div>
              <div className="composer-area">
                {!task && (
                  <label className="path-input">
                    <Icon name="folder" />
                    <input
                      aria-label="项目目录"
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="项目的绝对路径"
                    />
                  </label>
                )}
                <div className="composer">
                  <textarea
                    aria-label={task ? '结果反馈' : '任务需求'}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      task
                        ? running
                          ? '当前轮正在执行，结束后可继续反馈…'
                          : '告诉领队你对结果的反馈，继续调整…'
                        : '描述你想完成的任务…'
                    }
                    disabled={!!running}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        if (!busy && !running && input.trim()) void submit();
                      }
                    }}
                  />
                  <div className="composer-bottom">
                    <span>
                      <i className="dot completed" />{' '}
                      {task
                        ? `使用任务配置 v${task.config.version}`
                        : `全局战队 v${boot.config?.version}`}
                      <span className="shortcut">⌘ ↵</span>
                    </span>
                    <div>
                      {task && (running || task.status === 'awaiting_confirmation') && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void act(() => api(`/tasks/${task.id}/cancel`, 'POST', {}))
                          }
                        >
                          取消本轮
                        </button>
                      )}
                      <button
                        className="send-button"
                        aria-label={task ? '提交反馈' : '提交任务'}
                        disabled={busy || !!running || !input.trim() || (!!task && !canFeedback)}
                        onClick={() => void submit()}
                      >
                        <Icon name="arrow" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="composer-hint">
                  {task
                    ? '反馈会重新拆解，确认后执行；自动返工每轮最多一次。'
                    : '领队会先给出分工。工作目录需已存在，代码会直接写入该目录。'}
                </div>
              </div>
            </section>
            {panel && task && (
              <aside className="inspector">
                <div className="inspector-title">
                  任务详情<span>第 {round?.number} 轮</span>
                </div>
                <div className="section-label">全局配置快照</div>
                <div className="team-stack">
                  {task.config.profiles.map((p) => (
                    <div className="profile-mini" key={p.id}>
                      <span className={'mini-avatar ' + p.role}>{p.name.slice(0, 1)}</span>
                      <div>
                        <strong>
                          {p.name}
                          <small>{roles[p.role]}</small>
                        </strong>
                        <span>
                          {p.model.split('/').at(-1)} · {p.thinking || '默认'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="inspector-note">
                  角色使用独立会话 · 共享账号额度
                  <br />
                  后续全局修改不影响这个任务
                </div>
                <div className="section-label">本轮流程</div>
                <ol className="pipeline">
                  <li>领队拆解分工</li>
                  <li>用户确认</li>
                  <li>顺序执行</li>
                  <li>独立 review</li>
                  <li>
                    最多一次返工 <small>{round?.reworks ?? 0}/1</small>
                  </li>
                  <li>汇总 → 接收反馈</li>
                </ol>
                <div className="section-label">
                  文件变更 <span>{round?.artifacts.length ?? 0}</span>
                </div>
                <div className="artifact-list">
                  {round?.artifacts.length ? (
                    round.artifacts.map((a) => (
                      <button
                        key={a.path}
                        className={artifact === a.path ? 'active' : ''}
                        onClick={() => setArtifact(artifact === a.path ? null : a.path)}
                      >
                        <span className={'file-kind ' + a.kind}>
                          {a.kind === 'added' ? '+' : a.kind === 'removed' ? '−' : '~'}
                        </span>
                        {a.path}
                      </button>
                    ))
                  ) : (
                    <p className="muted">执行后在这里查看变更。</p>
                  )}
                </div>
                <p className="inspector-note">
                  预览仅包含小型文本文件；忽略依赖、构建目录、.env 与符号链接。
                </p>
              </aside>
            )}
            {task && round && executionSession !== null && (
              <ExecutionDetails
                key={task.id + ':' + round.number}
                task={task}
                round={round.number}
                initialSession={executionSession}
                close={() => setExecutionSession(null)}
              />
            )}
            {artifact && round && (
              <div className="diff-overlay" role="dialog" aria-label="文件变更预览">
                <div className="diff-modal">
                  <header>
                    <strong>{artifact}</strong>
                    <button onClick={() => setArtifact(null)}>关闭 ×</button>
                  </header>
                  {round.artifacts.find((a) => a.path === artifact)?.truncated && (
                    <div className="warning-card">
                      内容超过预览限制，已截断。请在项目目录检查完整文件。
                    </div>
                  )}
                  <div className="diff-columns">
                    <section>
                      <h3>修改前</h3>
                      <pre>
                        {round.artifacts.find((a) => a.path === artifact)?.before ||
                          '（文件不存在）'}
                      </pre>
                    </section>
                    <section>
                      <h3>修改后</h3>
                      <pre>
                        {round.artifacts.find((a) => a.path === artifact)?.after ||
                          '（文件已删除）'}
                      </pre>
                    </section>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
