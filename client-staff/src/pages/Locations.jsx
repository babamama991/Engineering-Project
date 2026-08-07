import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n.jsx';
import LangToggle from '../components/LangToggle.jsx';
import Spinner from '../components/Spinner.jsx';

export default function Locations() {
  const { user, logout } = useAuth();
  const { t, pick } = useLang();
  const navigate = useNavigate();

  const [locations, setOutlets] = useState([]);
  const [progress, setProgress] = useState({});
  const [shift, setShift] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try {
      const [outletRes, progressRes] = await Promise.all([
        api.get('/locations'),
        api.get('/runs/my-progress'),
      ]);
      setOutlets(outletRes.data);
      setShift(progressRes.data.shift);
      setProgress(Object.fromEntries(progressRes.data.locations.map((o) => [o.locationId, o])));
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Coming back from a checklist should show updated counters.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  if (loading) {
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="app-bar">
        <div>
          <div className="app-bar-title">{user.fullName}</div>
          {shift && (
            <div className="app-bar-sub">
              {pick(shift, 'name')} Â· {shift.startTime}–{shift.endTime} Â· {shift.businessDate}
            </div>
          )}
        </div>
        <div className="app-bar-actions">
          <LangToggle subtle />
          {/* Spelled out rather than an icon — no symbol reads unambiguously as
              "sign out", and this bar has room for the label. */}
          <button className="bar-btn" onClick={logout}>
            {t('signOut')}
          </button>
        </div>
      </header>

      <main className="content">
        {shift?.source === 'unscheduled' && (
          <div className="alert warn">{t('unscheduled')}</div>
        )}

        {error && (
          <div className="alert error">
            {error}{' '}
            <button className="link-btn" onClick={load}>
              {t('retry')}
            </button>
          </div>
        )}

        <h2 className="section-title">{t('chooseOutlet')}</h2>

        <div className="location-grid">
          {locations.map((o) => {
            const p = progress[o.id] || { total: o.taskCount, answered: 0, failed: 0, status: 'not_started' };
            const pct = p.total ? Math.round((p.answered / p.total) * 100) : 0;
            const state =
              p.status === 'completed' ? 'completed' : p.answered > 0 ? 'progress' : 'idle';

            return (
              <button
                key={o.id}
                className={`location-card ${state}`}
                onClick={() => navigate(`/location/${o.id}`)}
              >
                <div className="location-card-top">
                  <span className="location-name">{pick(o, 'name')}</span>
                  {p.failed > 0 && <span className="pill danger">{p.failed}</span>}
                </div>

                {o.location && <div className="location-detail">{o.location}</div>}

                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>

                <div className="location-card-bottom">
                  <span>
                    {p.answered}/{p.total} {t('done')}
                  </span>
                  <span className={`status-tag ${state}`}>
                    {p.status === 'completed'
                      ? t('completed')
                      : p.answered > 0
                        ? t('inProgress')
                        : t('notStarted')}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
