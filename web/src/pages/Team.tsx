import { useEffect, useState, useRef } from 'react';
import type { Config, Profile } from '../../../server/types';
import { api, type Bootstrap } from '../lib/api';
import { roles } from '../lib/labels';
import { Icon } from '../components/Icon';
export function Team({
  boot,
  act,
  busy,
  onSaved,
}: {
  boot: Bootstrap;
  act: (fn: () => Promise<any>) => Promise<void>;
  busy: boolean;
  onSaved: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>(boot.config?.profiles ?? []),
    [executable, setExecutable] = useState(
      boot.discovery?.executable ?? boot.config?.executable ?? '',
    ),
    [strategy, setStrategy] = useState<Config['strategy']>(boot.config?.strategy ?? 'balanced'),
    [permission, setPermission] = useState<Config['permissionMode']>(
      boot.config?.permissionMode ?? 'auto',
    ),
    [recommendation, setRecommendation] = useState('');
  const attempted = useRef(false);
  useEffect(() => {
    if (!boot.discovery && !attempted.current) {
      attempted.current = true;
      void act(async () => {
        const d = await api('/discover', 'POST', {});
        setExecutable(d.executable);
        if (d.models.length)
          await Promise.allSettled([api('/quota', 'POST', {}), api('/research', 'POST', {})]);
      });
    }
  }, []);
  useEffect(() => {
    if (!executable && boot.discovery?.executable) setExecutable(boot.discovery.executable);
  }, [boot.discovery]);
  const update = (i: number, field: keyof Profile, value: string) =>
    setProfiles(profiles.map((p, n) => (n === i ? { ...p, [field]: value } : p)));
  const models = boot.models;
  return (
    <div className="settings-page">
      <div className="eyebrow">{boot.config ? '全局配置' : '首次安装 · 初始化'}</div>
      <h1>组建你的战队</h1>
      <p className="page-description">
        先连接本地 coding agent，再配置领队、执行者和审查员。
        <br />
        这是一份全局配置，可以随时修改；每个新任务会保存当时的快照。
      </p>
      <div className="setup-progress">
        <span className={boot.discovery?.models.length ? 'done' : 'current'}>1 连接 Kimi</span>
        <b>→</b>
        <span className={profiles.length ? 'done' : 'current'}>2 配置战队</span>
        <b>→</b>
        <span>3 保存并开始</span>
      </div>
      <section className="settings-card">
        <div className="card-heading">
          <div className="agent-logo">K</div>
          <div>
            <strong>Kimi Code</strong>
            <span>{boot.discovery?.version ?? '从本地 CLI 主动发现模型与 thinking 选项'}</span>
          </div>
          <span className="connection-badge">
            {boot.discovery?.installed ? '已发现' : '等待探测'}
          </span>
        </div>
        <div className="inline-form">
          <input
            aria-label="Kimi 可执行文件"
            value={executable}
            onChange={(e) => setExecutable(e.target.value)}
            placeholder="自动发现，或填写 Kimi 可执行文件绝对路径"
          />
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const d = await api('/discover', 'POST', { executable: executable || undefined });
                setExecutable(d.executable);
                if (d.models.length)
                  await Promise.allSettled([
                    api('/quota', 'POST', {}),
                    api('/research', 'POST', {}),
                  ]);
              })
            }
          >
            {busy ? '处理中…' : '探测 / 刷新'}
          </button>
        </div>
        {boot.discovery?.error && <p className="warning-text">{boot.discovery.error}</p>}
        <p className="muted">
          {boot.discovery?.models.length ?? 0} 个真实可用模型 · 登录态
          {boot.discovery?.authenticated === true ? '已找到' : '待验证'} · 其他 coding agent
          将在后续接入
        </p>
      </section>
      <section className="settings-card">
        <div className="section-heading">
          <div>
            <h2>战队推荐</h2>
            <p>先给出起点，再按你的习惯调整角色与描述。</p>
          </div>
          <div className="segmented">
            {(['balanced', 'economy', 'quality'] as const).map((s) => (
              <button
                key={s}
                className={strategy === s ? 'active' : ''}
                onClick={() => setStrategy(s)}
              >
                {{ balanced: '均衡', economy: '节省', quality: '质量优先' }[s]}
              </button>
            ))}
          </div>
        </div>
        <button
          className="secondary"
          disabled={busy || !models.length}
          onClick={() =>
            void act(async () => {
              const r = await api('/recommend', 'POST', { strategy });
              setProfiles(r.profiles);
              setStrategy(r.effectiveStrategy);
              setRecommendation(r.reason);
            })
          }
        >
          <Icon name="grid" />
          生成推荐配置
        </button>
        {recommendation && <p className="recommendation-note">{recommendation}</p>}
        <div className="profiles-editor">
          {profiles.map((p, i) => (
            <div className="profile-editor" key={p.id}>
              <div className="profile-editor-head">
                <span className={'mini-avatar ' + p.role}>{roles[p.role].slice(0, 1)}</span>
                <strong>{roles[p.role]}</strong>
                <span>{p.id}</span>
                {p.role === 'worker' && profiles.filter((p) => p.role === 'worker').length > 1 && (
                  <button
                    className="text-button"
                    onClick={() => setProfiles(profiles.filter((_, n) => n !== i))}
                  >
                    移除
                  </button>
                )}
              </div>
              <div className="profile-fields">
                <label>
                  成员名称
                  <input
                    aria-label={`${p.id} 名称`}
                    value={p.name}
                    onChange={(e) => update(i, 'name', e.target.value)}
                  />
                </label>
                <label>
                  模型
                  <select
                    aria-label={`${p.id} 模型`}
                    value={p.model}
                    onChange={(e) => {
                      const model = models.find((m) => m.id === e.target.value)!;
                      setProfiles(
                        profiles.map((v, n) =>
                          n === i
                            ? {
                                ...v,
                                model: model.id,
                                thinking: model.efforts.includes(v.thinking)
                                  ? v.thinking
                                  : (model.efforts[0] ?? ''),
                              }
                            : v,
                        ),
                      );
                    }}
                  >
                    {models.map((m) => (
                      <option value={m.id} key={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Thinking
                  <select
                    aria-label={`${p.id} thinking`}
                    value={p.thinking}
                    onChange={(e) => update(i, 'thinking', e.target.value)}
                  >
                    {(models.find((m) => m.id === p.model)?.efforts ?? ['']).map((t) => (
                      <option value={t} key={t}>
                        {t || '默认'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                角色描述
                <textarea
                  aria-label={`${p.id} 描述`}
                  value={p.description}
                  onChange={(e) => update(i, 'description', e.target.value)}
                  placeholder="擅长的工作、模型特点、使用偏好…"
                />
              </label>
            </div>
          ))}
        </div>
        {profiles.length > 0 && profiles.length < 12 && (
          <button
            className="text-button"
            onClick={() => {
              const model = models.find((m) => m.default) ?? models[0];
              setProfiles([
                ...profiles,
                {
                  id: 'worker-' + Date.now(),
                  name: '新执行者',
                  role: 'worker',
                  model: model.id,
                  thinking: model.efforts.includes('high') ? 'high' : (model.efforts[0] ?? ''),
                  description: '',
                },
              ]);
            }}
          >
            ＋ 添加执行者
          </button>
        )}
      </section>
      <section className="settings-card">
        <h2>执行权限</h2>
        <div className="permission-options">
          <label>
            <input
              type="radio"
              name="permission"
              checked={permission === 'auto'}
              onChange={() => setPermission('auto')}
            />
            <div>
              <strong>自动执行常规操作</strong>
              <span>常规编辑与命令自动执行；Kimi 的风险确认与问题会转发到工作台。</span>
            </div>
          </label>
          <label>
            <input
              type="radio"
              name="permission"
              checked={permission === 'default'}
              onChange={() => setPermission('default')}
            />
            <div>
              <strong>使用 Kimi 原生手动审批</strong>
              <span>按 Kimi 返回的权限选项逐次决定。</span>
            </div>
          </label>
        </div>
        <p className="muted">
          领队和审查员只读分析。执行直接修改你选择的目录，取消会保留已有改动。
        </p>
      </section>
      <div className="settings-footer">
        <span>同一账号下所有成员共享额度，不会因为增加成员而增加余额。</span>
        <button
          className="primary"
          disabled={busy || profiles.length < 3 || !boot.discovery?.models.length}
          onClick={() =>
            void act(async () => {
              await api('/config', 'PUT', {
                executable,
                strategy,
                permissionMode: permission,
                profiles,
              });
              onSaved();
            })
          }
        >
          保存全局配置
        </button>
      </div>
    </div>
  );
}
