import { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useLang } from '../i18n.jsx';
import Spinner from '../components/Spinner.jsx';

export default function Settings() {
  const { t, pick } = useLang();
  const [settings, setSettings] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [activity, setActivity] = useState([]);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [s, sh, act] = await Promise.all([
        api.get('/settings'),
        api.get('/shifts'),
        api.get('/dashboard/activity', { params: { limit: 30 } }),
      ]);
      setSettings(s.data);
      setShifts(sh.data);
      setActivity(act.data);
    } catch (err) {
      setError(err.userMessage);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch('/settings', {
        hotel_name: settings.hotel_name,
        timezone: settings.timezone,
        allow_unscheduled: settings.allow_unscheduled,
        lock_run_on_complete: settings.lock_run_on_complete,
      });
      setFlash(t('saved'));
      setTimeout(() => setFlash(''), 2500);
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  const saveShift = async (shift, patch) => {
    try {
      await api.patch(`/shifts/${shift.id}`, patch);
      await load();
    } catch (err) {
      setError(err.userMessage);
    }
  };

  if (!settings) return <div className="center-screen"><Spinner /></div>;

  const set = (k) => (e) =>
    setSettings((s) => ({
      ...s,
      [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));

  return (
    <div className="page-body">
      <div className="page-head">
        <h1>{t('settings')}</h1>
      </div>

      {error && <div className="alert error">{error}</div>}
      {flash && <div className="alert ok">{flash}</div>}

      <section className="panel">
        <h3>General</h3>
        <label className="field">
          <span>{t('hotelName')}</span>
          <input value={settings.hotel_name || ''} onChange={set('hotel_name')} />
        </label>
        <label className="field">
          <span>{t('timezone')}</span>
          <input value={settings.timezone || ''} onChange={set('timezone')} placeholder="Asia/Beirut" />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!settings.allow_unscheduled}
            onChange={set('allow_unscheduled')}
          />
          <span>{t('allowUnscheduled')}</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!settings.lock_run_on_complete}
            onChange={set('lock_run_on_complete')}
          />
          <span>{t('lockOnComplete')}</span>
        </label>
        <div className="filter-actions">
          <button className="btn primary" onClick={saveSettings} disabled={saving}>
            {saving ? <Spinner small /> : t('save')}
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>{t('shiftTimes')}</h3>
        <p className="muted small">
          These windows decide which shift a check belongs to when someone isn’t on the roster.
          A shift whose end is earlier than its start crosses midnight and stays on the day it started.
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('code')}</th>
                <th>{t('name')}</th>
                <th>{t('startTime')}</th>
                <th>{t('endTime')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.code}</td>
                  <td>{pick(s, 'name')}</td>
                  <td>
                    <input
                      type="time"
                      defaultValue={s.startTime}
                      onBlur={(e) =>
                        e.target.value !== s.startTime && saveShift(s, { startTime: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      defaultValue={s.endTime}
                      onBlur={(e) =>
                        e.target.value !== s.endTime && saveShift(s, { endTime: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    {s.crossesMidnight && <span className="tag sm">{t('crossesMidnight')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>{t('activityLog')}</h3>
        <ul className="plain-list activity">
          {activity.map((a) => (
            <li key={a.id}>
              <span className="mono small">{new Date(a.createdAt).toLocaleString()}</span>{' '}
              <strong>{a.actor}</strong> · {a.action}
              {a.entityId ? ` #${a.entityId}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
