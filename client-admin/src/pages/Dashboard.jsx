import { useCallback, useEffect, useState } from 'react';
import api, { fileUrl } from '../api/client.js';
import { useLang } from '../i18n.jsx';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const clock = (iso) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

export default function Dashboard() {
  const { t, pick } = useLang();

  const [live, setLive] = useState(null);
  const [stats, setStats] = useState(null);
  const [date, setDate] = useState(today());
  const [shiftId, setShiftId] = useState('');
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // The run whose detail is open. `null` = closed.
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openRun = async (runId) => {
    setDetailLoading(true);
    setDetail({ loading: true });
    try {
      const { data } = await api.get(`/dashboard/runs/${runId}`);
      setDetail(data);
    } catch (err) {
      setError(err.userMessage);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const load = useCallback(async () => {
    setError('');
    try {
      const [liveRes, statsRes] = await Promise.all([
        api.get('/dashboard/live', {
          params: { date, ...(shiftId ? { shiftId } : {}) },
        }),
        api.get('/dashboard/stats', { params: { from: daysAgo(6), to: today() } }),
      ]);
      setLive(liveRes.data);
      setStats(statsRes.data);
      if (!shiftId) setShiftId(String(liveRes.data.shiftId));
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setLoading(false);
    }
  }, [date, shiftId]);

  useEffect(() => {
    load();
  }, [load]);

  // The point of this screen is to be current — poll while it's on screen.
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(load, 5_000);
    return () => clearInterval(id);
  }, [auto, load]);

  if (loading) {
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="page-body">
      <div className="page-head">
        <h1>{t('dashboard')}</h1>
        <div className="filters">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            {live?.shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {pick(s, 'name')} ({s.startTime}–{s.endTime})
              </option>
            ))}
          </select>
          <label className="check inline">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span>{t('autoRefresh')}</span>
          </label>
          <button className="btn ghost sm" onClick={load}>
            {t('refresh')}
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {stats && (
        <div className="stat-row">
          <Stat label={t('checksLogged')} value={stats.answers} sub="last 7 days" />
          <Stat label={t('openIssues')} value={stats.failures} tone={stats.failures ? 'danger' : ''} sub="last 7 days" />
          <Stat label={t('criticalIssues')} value={stats.critical_failures} tone={stats.critical_failures ? 'danger' : ''} sub="last 7 days" />
          <Stat label={t('activeStaff')} value={stats.active_users} sub="last 7 days" />
          <Stat label={t('unscheduledRuns')} value={stats.unscheduled_runs} tone={stats.unscheduled_runs ? 'warn' : ''} sub="last 7 days" />
        </div>
      )}

      <h2 className="section-title">
        {t('coverage')} · {live.businessDate}
      </h2>

      <div className="card-grid">
        {live.locations.map((o) => (
          <div key={o.id} className={`panel location-panel ${o.coverage}`}>
            <div className="panel-head">
              <strong>{pick(o, 'name')}</strong>
              <span className={`tag ${o.coverage}`}>
                {o.coverage === 'untouched'
                  ? t('untouched')
                  : o.coverage === 'completed'
                    ? t('completed')
                    : t('inProgress')}
              </span>
            </div>

            {o.runs.length === 0 ? (
              <p className="muted small">0 / {o.totalTasks}</p>
            ) : (
              o.runs.map((r) => {
                const pct = r.total ? Math.round((r.answered / r.total) * 100) : 0;
                return (
                  <button
                    type="button"
                    className="run-line"
                    key={r.runId}
                    onClick={() => openRun(r.runId)}
                    title={t('viewRunDetail')}
                  >
                    <div className="run-top">
                      <span>
                        {r.userName}
                        {r.source === 'unscheduled' && <span className="tag warn sm">!</span>}
                      </span>
                      <span className="mono">
                        {r.answered}/{r.total}
                        {r.failed > 0 && <span className="text-danger"> · {r.failed}✕</span>}
                      </span>
                    </div>
                    <div className="bar">
                      <div className="bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="run-foot muted small">
                      {t('lastActivity')}: {clock(r.lastActivity)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        ))}
      </div>

      <div className="two-col">
        <section className="panel">
          <h3>{t('openIssues')}</h3>
          {live.failures.length === 0 ? (
            <p className="muted small">{t('noIssues')}</p>
          ) : (
            <ul className="issue-list">
              {live.failures.map((f) => (
                <li key={f.answerId} className={f.isCritical ? 'critical' : ''}>
                  <div className="issue-top">
                    <strong>{pick(f, 'taskTitle')}</strong>
                    {f.isCritical && <span className="tag danger sm">{t('critical')}</span>}
                  </div>
                  <div className="muted small">
                    {pick(f, 'outletName')} · {f.userName} · {f.shiftCode} · {clock(f.answeredAt)}
                    {f.photoCount > 0 && ` · 📷${f.photoCount}`}
                  </div>
                  {f.comment && <div className="issue-comment">{f.comment}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h3>{t('notStartedYet')}</h3>
          {live.notStarted.length === 0 ? (
            <p className="muted small">—</p>
          ) : (
            <ul className="plain-list">
              {live.notStarted.map((u) => (
                <li key={u.userId}>{u.userName}</li>
              ))}
            </ul>
          )}

          <h3 className="mt">{t('workingUnscheduled')}</h3>
          {live.unscheduled.length === 0 ? (
            <p className="muted small">—</p>
          ) : (
            <ul className="plain-list">
              {live.unscheduled.map((u) => (
                <li key={u.runId}>{u.userName}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {detail && (
        <Modal
          wide
          title={
            detail.loading
              ? t('loading')
              : `${pick(detail.run, 'locationName')} · ${detail.run.userName}`
          }
          onClose={() => setDetail(null)}
        >
          {detail.loading || detailLoading ? (
            <div className="center-screen"><Spinner /></div>
          ) : (
            <>
              <p className="muted small">
                {detail.run.businessDate} · {pick(detail.run, 'shiftName')} ·{' '}
                {detail.summary.done}/{detail.summary.total} {t('done')}
                {detail.summary.failed > 0 && (
                  <span className="text-danger"> · {detail.summary.failed} {t('no')}</span>
                )}
                {detail.run.source === 'unscheduled' && (
                  <span className="tag warn sm">{t('unscheduledRuns')}</span>
                )}
              </p>

              <div className="table-scroll">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>{t('time')}</th>
                      <th>{t('subLocation')}</th>
                      <th>{t('task')}</th>
                      <th>{t('answer')}</th>
                      <th>{t('staff')}</th>
                      <th>{t('comment')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Answered first (newest at the top), outstanding last —
                        the server orders it that way. */}
                    {detail.tasks.map((task) => (
                      <tr
                        key={task.taskId}
                        className={
                          !task.answered ? 'row-muted' : task.answer ? '' : 'row-fail'
                        }
                      >
                        <td className="mono nowrap">{task.localTime || '—'}</td>
                        <td>{pick(task, 'subLocationName') || '—'}</td>
                        <td>
                          {pick(task, 'description')}
                          {task.isCritical && (
                            <span className="tag danger sm">{t('critical')}</span>
                          )}
                          {task.revision > 1 && <span className="tag sm">{t('edited')}</span>}
                        </td>
                        <td className={task.answer ? 'ok bold' : task.answered ? 'text-danger bold' : 'muted'}>
                          {task.answered ? (task.answer ? t('yes') : t('no')) : t('untouched')}
                        </td>
                        <td className="nowrap">{task.answeredBy || '—'}</td>
                        <td className="comment-cell">
                          {task.comment}
                          {task.photos?.length > 0 && (
                            <div className="report-thumbs">
                              {task.photos.map((p) => (
                                <a
                                  key={p.id}
                                  className="report-thumb"
                                  href={fileUrl(p.url)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <img src={fileUrl(p.url)} alt="" loading="lazy" />
                                </a>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone = '' }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
