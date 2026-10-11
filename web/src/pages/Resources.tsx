import { api, type Bootstrap } from '../lib/api';
export function Resources({
  boot,
  act,
  busy,
}: {
  boot: Bootstrap;
  act: (fn: () => Promise<any>) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="settings-page">
      <div className="eyebrow">模型与资源</div>
      <h1>了解你的可用资源</h1>
      <p className="page-description">
        模型来自本机 agent 的真实选项。额度来自已登录账号；公开能力资料保留来源和更新时间。
      </p>
      <section className="settings-card">
        <div className="section-heading">
          <div>
            <h2>Kimi 账号额度</h2>
            <p>战队所有成员共享同一个额度池</p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void act(() => api('/quota', 'POST', {}))}
          >
            刷新额度
          </button>
        </div>
        {boot.quota?.windows.length ? (
          <div className="quota-windows">
            {boot.quota.windows.map((w, i) => (
              <div className="quota-window" key={i}>
                <div>
                  <strong>{w.name}</strong>
                  <span>
                    {boot.quota?.status === 'stale' ? '上次已知 ' : ''}剩余{' '}
                    {Math.round(100 - w.usedPercent)}%
                  </span>
                </div>
                <div className="progress-track">
                  <div style={{ width: 100 - w.usedPercent + '%' }} />
                </div>
                <small>
                  {w.resetsAt
                    ? '重置时间：' + new Date(w.resetsAt).toLocaleString('zh-CN')
                    : '重置时间未知'}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">额度未知，尚未读取或接口不可用。不会按 0 额度处理。</p>
        )}
        {boot.quota?.note && (
          <p className="warning-text">
            {boot.quota.status === 'stale' && '数据已过期 · '}
            {boot.quota.note}
          </p>
        )}
        {boot.quota && (
          <p className="source-note">
            来源 {boot.quota.source} · 查询时间{' '}
            {new Date(boot.quota.observedAt).toLocaleString('zh-CN')}
          </p>
        )}
      </section>
      <section className="settings-card">
        <div className="section-heading">
          <div>
            <h2>本机模型列表</h2>
            <p>模型和 thinking 档位在切换后逐个探测</p>
          </div>
          <button
            className="secondary"
            disabled={busy || !boot.models.length}
            onClick={() => void act(() => api('/research', 'POST', {}))}
          >
            查询公开能力资料
          </button>
        </div>
        {boot.models.map((m) => (
          <article className="model-card" key={m.id}>
            <div>
              <h3>
                {m.name}
                {m.default && <span className="tiny-badge">本机默认</span>}
              </h3>
              <code>{m.id}</code>
            </div>
            <div className="model-efforts">
              {m.efforts.map((e) => (
                <span key={e}>{e}</span>
              ))}
            </div>
            <p>{m.capabilityNote ?? '尚未查询公开资料；实际能力待真实任务评测。'}</p>
            <div className="source-note">
              {m.source}
              {m.researchedAt && ' · ' + new Date(m.researchedAt).toLocaleString('zh-CN')}
              {m.references?.map((r) => (
                <a href={r.url} key={r.url} target="_blank" rel="noreferrer">
                  {r.title} ↗
                </a>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
