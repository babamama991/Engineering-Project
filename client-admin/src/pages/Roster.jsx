import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { downloadFile } from '../api/client.js';
import { useLang } from '../i18n.jsx';
import Spinner from '../components/Spinner.jsx';

/** Monday of the week containing `d`. */
function weekStart(d = new Date()) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Mon=0 … Sun=6
  date.setDate(date.getDate() - day);
  date.setHours(12, 0, 0, 0); // midday avoids DST edge cases when adding days
  return date;
}

const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate()
  ).padStart(2, '0')}`;
};

const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export default function Roster() {
  const { t, pick, lang } = useLang();

  const [monday, setMonday] = useState(() => weekStart());
  const [users, setUsers] = useState([]);
  const [shifts, setShifts] = useState([]);
  // key `${userId}|${YYYY-MM-DD}` -> shiftTypeId (number) or '' for off
  const [grid, setGrid] = useState({});
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const days = useMemo(() => [...Array(7)].map((_, i) => addDays(monday, i)), [monday]);
  const from = iso(days[0]);
  const to = iso(days[6]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [u, s, r] = await Promise.all([
        api.get('/users'),
        api.get('/shifts'),
        api.get('/roster', { params: { from, to } }),
      ]);
      setUsers(u.data.filter((x) => x.isActive));
      setShifts(s.data);
      setGrid(
        Object.fromEntries(r.data.map((a) => [`${a.userId}|${a.workDate}`, a.shiftTypeId]))
      );
      setDirty(false);
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const setCell = (userId, date, value) => {
    setGrid((g) => {
      const next = { ...g };
      const key = `${userId}|${date}`;
      if (value === '') delete next[key];
      else next[key] = Number(value);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const assignments = Object.entries(grid).map(([key, shiftTypeId]) => {
        const [userId, workDate] = key.split('|');
        return { userId: Number(userId), shiftTypeId, workDate };
      });
      await api.put('/roster/bulk', { from, to, assignments });
      setDirty(false);
      setFlash(t('rosterSaved'));
      setTimeout(() => setFlash(''), 2500);
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  const copyToNextWeek = async () => {
    setSaving(true);
    try {
      await api.post('/roster/copy-week', {
        fromWeekStart: from,
        toWeekStart: iso(addDays(monday, 7)),
      });
      setFlash(t('saved'));
      setTimeout(() => setFlash(''), 2500);
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    setError('');
    try {
      await downloadFile('/roster/export.xlsx', { from, to }, `schedule_${from}_to_${to}.xlsx`);
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setExporting(false);
    }
  };

  const dayLabel = (d) =>
    d.toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { weekday: 'short', day: 'numeric', month: 'short' });

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
        <h1>{t('roster')}</h1>
        <div className="filters">
          <button className="btn ghost sm" onClick={() => setMonday(addDays(monday, -7))}>
            ‹ {t('prevWeek')}
          </button>
          <button className="btn ghost sm" onClick={() => setMonday(weekStart())}>
            {t('thisWeek')}
          </button>
          <button className="btn ghost sm" onClick={() => setMonday(addDays(monday, 7))}>
            {t('nextWeek')} ›
          </button>
          <button className="btn ghost sm" onClick={exportExcel} disabled={exporting}>
            {exporting ? <Spinner small /> : t('exportSchedule')}
          </button>
        </div>
      </div>

      <p className="muted small">
        {t('week')}: {from} → {to} · {t('clickToAssign')}
      </p>

      {error && <div className="alert error">{error}</div>}
      {flash && <div className="alert ok">{flash}</div>}

      <section className="panel">
        <div className="table-scroll">
          <table className="table roster-table">
            <thead>
              <tr>
                <th className="sticky-col">{t('staff')}</th>
                {days.map((d) => (
                  <th key={iso(d)} className={iso(d) === iso(new Date()) ? 'today' : ''}>
                    {dayLabel(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="sticky-col">
                    <div>{u.fullName}</div>
                    <div className="muted small">@{u.username}</div>
                  </td>
                  {days.map((d) => {
                    const date = iso(d);
                    const value = grid[`${u.id}|${date}`] ?? '';
                    return (
                      <td key={date} className="roster-cell">
                        <select
                          className={`shift-select s-${value || 'off'}`}
                          value={value}
                          onChange={(e) => setCell(u.id, date, e.target.value)}
                        >
                          <option value="">{t('off')}</option>
                          {shifts.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.code}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="filter-actions">
          <button className="btn primary" onClick={save} disabled={saving || !dirty}>
            {saving ? <Spinner small /> : t('saveRoster')}
          </button>
          <button className="btn ghost" onClick={copyToNextWeek} disabled={saving}>
            {t('copyWeek')}
          </button>
          {dirty && <span className="muted small">•</span>}
        </div>
      </section>

      <section className="panel">
        <h3>{t('shiftTimes')}</h3>
        <ul className="plain-list">
          {shifts.map((s) => (
            <li key={s.id}>
              <strong>{s.code}</strong> — {pick(s, 'name')} · {s.startTime}–{s.endTime}
              {s.crossesMidnight && <span className="tag sm">{t('crossesMidnight')}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
