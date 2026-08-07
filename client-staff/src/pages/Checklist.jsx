import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useLang } from '../i18n.jsx';
import TaskRow from '../components/TaskRow.jsx';
import Spinner from '../components/Spinner.jsx';

export default function Checklist() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const { t, pick, dir } = useLang();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [completing, setCompleting] = useState(false);
  // taskId -> true | false | null. Single source of truth for every counter on
  // this screen, so the header and each section header stay in step as the user
  // ticks, with no refetch.
  const [answers, setAnswers] = useState({});

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const { data } = await api.get('/runs/current', { params: { locationId } });
      setData(data);
      setAnswers(
        Object.fromEntries(
          data.subLocations.flatMap((c) => c.tasks.map((t) => [t.id, t.answer ?? null]))
        )
      );
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = useCallback(({ taskId, answer }) => {
    setAnswers((prev) => ({ ...prev, [taskId]: answer }));
  }, []);

  const summary = useMemo(() => {
    const values = Object.values(answers);
    return {
      total: values.length,
      answered: values.filter((v) => v !== null && v !== undefined).length,
      failed: values.filter((v) => v === false).length,
    };
  }, [answers]);

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const answeredByCategory = useMemo(() => {
    if (!data) return {};
    return Object.fromEntries(
      data.subLocations.map((c) => [
        c.subLocationId ?? 0,
        c.tasks.filter((x) => answers[x.id] !== null && answers[x.id] !== undefined).length,
      ])
    );
  }, [data, answers]);

  const complete = async () => {
    setCompleting(true);
    try {
      await api.post(`/runs/${data.run.id}/complete`);
      navigate('/');
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="center-screen">
        <div className="alert error">{error}</div>
        <button className="btn primary" onClick={load}>
          {t('retry')}
        </button>
        <button className="btn ghost" onClick={() => navigate('/')}>
          {t('back')}
        </button>
      </div>
    );
  }

  const pct = summary.total ? Math.round((summary.answered / summary.total) * 100) : 0;
  const remaining = summary.total - summary.answered;

  return (
    <div className="page">
      <header className="app-bar sticky">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label={t('back')}>
          {dir === 'rtl' ? '→' : '←'}
        </button>

        <div className="app-bar-center">
          <div className="app-bar-title">{pick(data.location, 'name')}</div>
          <div className="app-bar-sub">
            {pick(data.run.shift, 'name')} · {data.run.businessDate}
          </div>
        </div>

        <div className="count-badge">
          {summary.answered}/{summary.total}
        </div>
      </header>

      <div className="progress-bar-sticky">
        <div className="progress-track thick">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="progress-legend">
          <span>
            {remaining > 0 ? `${remaining} ${t('remaining')}` : t('allDone')}
          </span>
          {summary.failed > 0 && (
            <span className="text-danger">
              {summary.failed} {t('issues')}
            </span>
          )}
        </div>
      </div>

      <main className="content checklist">
        {error && <div className="alert error">{error}</div>}

        {data.subLocations.length === 0 && <div className="empty">{t('noTasks')}</div>}

        {data.subLocations.map((cat) => {
          const key = cat.subLocationId ?? 0;
          const isCollapsed = collapsed.has(key);
          return (
            <section className={`cat ${isCollapsed ? 'is-collapsed' : ''}`} key={key}>
              <button className="cat-head" onClick={() => toggle(key)} aria-expanded={!isCollapsed}>
                <span className="cat-name">
                  {cat.icon && <span className="cat-icon">{cat.icon}</span>}
                  {pick(cat, 'name')}
                </span>
                <span className="cat-right">
                  <span className="cat-count">
                    {answeredByCategory[key]}/{cat.tasks.length}
                  </span>
                  <span className={`chev ${isCollapsed ? '' : 'open'}`}>▾</span>
                </span>
              </button>

              {/* Always mounted so the open/close can be animated — unmounting
                  the list would leave nothing to transition. The height comes
                  from the CSS grid trick in .cat-body, and the collapsed state
                  also hides it from keyboard focus. */}
              <div className="cat-body">
                <ul className="task-list">
                  {cat.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      runId={data.run.id}
                      onChange={handleChange}
                    />
                  ))}
                </ul>
              </div>
            </section>
          );
        })}

        <div className="submit-zone">
          <button
            className="btn primary block lg"
            onClick={complete}
            disabled={completing || summary.answered === 0}
          >
            {completing ? <Spinner small /> : t('completeRound')}
          </button>
          {data.run.status === 'completed' && (
            <p className="muted center">{t('roundComplete')}</p>
          )}
        </div>
      </main>
    </div>
  );
}
