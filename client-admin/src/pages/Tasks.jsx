import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client.js';
import { useLang } from '../i18n.jsx';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';

const blank = {
  subLocationId: '',
  descriptionEn: '',
  descriptionAr: '',
  notesEn: '',
  notesAr: '',
  frequency: 'every_shift',
  shiftTypeId: '', // '' = every shift
  isCritical: false,
  requiresPhoto: false,
};

export default function Tasks() {
  const { t, pick } = useLang();

  const [locations, setOutlets] = useState([]);
  const [locationId, setOutletId] = useState('');
  const [subLocations, setCategories] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState(null); // null | {} for new | task for edit
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');

  const fileInput = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    Promise.all([api.get('/locations'), api.get('/sub-locations'), api.get('/shifts')])
      .then(([o, c, s]) => {
        setOutlets(o.data);
        setCategories(c.data);
        setShifts(s.data);
        if (o.data.length) setOutletId(String(o.data[0].id));
      })
      .catch((err) => setError(err.userMessage))
      .finally(() => setLoading(false));
  }, []);

  /**
   * Upload a checklist spreadsheet. The Location and Sub-Location columns can
   * introduce locations and subLocations this screen hasn't loaded, so everything
   * is refetched afterwards rather than patched in place.
   */
  const doImport = async (file) => {
    if (!file) return;
    setImporting(true);
    setError('');
    setImportResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.post('/tasks/import', body);

      const [o, c] = await Promise.all([api.get('/locations'), api.get('/sub-locations')]);
      setOutlets(o.data);
      setCategories(c.data);
      // Jump to the Location that was just imported so the result is visible.
      const target = o.data.find((x) => x.nameEn === data.locationsCreated[0]);
      if (target) setOutletId(String(target.id));
      setImportResult(data);
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const loadTasks = useCallback(async () => {
    if (!locationId) return;
    try {
      const { data } = await api.get('/tasks', { params: { locationId } });
      setTasks(data);
    } catch (err) {
      setError(err.userMessage);
    }
  }, [locationId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const task of tasks) {
      const key = task.subLocationId ?? 0;
      if (!map.has(key)) {
        map.set(key, {
          id: task.subLocationId,
          nameEn: task.subLocationNameEn || 'Uncategorised',
          nameAr: task.subLocationNameAr || 'غير مصنّف',
          icon: task.subLocationIcon,
          items: [],
        });
      }
      map.get(key).items.push(task);
    }
    return [...map.values()];
  }, [tasks]);

  const openNew = () => {
    setForm(blank);
    setEditing({});
  };

  const openEdit = (task) => {
    setForm({
      subLocationId: task.subLocationId ?? '',
      descriptionEn: task.descriptionEn,
      descriptionAr: task.descriptionAr,
      notesEn: task.notesEn || '',
      notesAr: task.notesAr || '',
      frequency: task.frequency,
      shiftTypeId: task.shiftTypeId ?? '',
      isCritical: task.isCritical,
      requiresPhoto: task.requiresPhoto,
    });
    setEditing(task);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        locationId: Number(locationId),
        subLocationId: form.subLocationId === '' ? null : Number(form.subLocationId),
        descriptionEn: form.descriptionEn.trim(),
        descriptionAr: form.descriptionAr.trim(),
        notesEn: form.notesEn.trim() || null,
        notesAr: form.notesAr.trim() || null,
        frequency: form.frequency,
        // '' means every shift, which the API stores as NULL.
        shiftTypeId: form.shiftTypeId === '' ? null : Number(form.shiftTypeId),
        isCritical: form.isCritical,
        requiresPhoto: form.requiresPhoto,
      };
      if (editing.id) {
        await api.patch(`/tasks/${editing.id}`, payload);
      } else {
        // New tasks land at the end of their subLocation.
        const siblings = tasks.filter((x) => (x.subLocationId ?? 0) === (payload.subLocationId ?? 0));
        payload.sortOrder = (siblings.at(-1)?.sortOrder ?? 0) + 10;
        await api.post('/tasks', payload);
      }
      setEditing(null);
      await loadTasks();
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (task) => {
    if (!window.confirm(`${t('confirmDelete')}\n\n${task.descriptionEn}`)) return;
    try {
      await api.delete(`/tasks/${task.id}`);
      await loadTasks();
    } catch (err) {
      setError(err.userMessage);
    }
  };

  /** Swap sort_order with the neighbour above/below inside the same subLocation. */
  const move = async (task, dir) => {
    const group = grouped.find((g) => (g.id ?? 0) === (task.subLocationId ?? 0));
    const idx = group.items.findIndex((x) => x.id === task.id);
    const swapWith = group.items[idx + dir];
    if (!swapWith) return;

    // Equal sort_order values would make the swap a no-op — renumber instead.
    const a = task.sortOrder;
    const b = swapWith.sortOrder;
    const items =
      a === b
        ? group.items.map((x, i) => ({
            id: x.id,
            sortOrder: (i === idx ? idx + dir : i === idx + dir ? idx : i) * 10,
          }))
        : [
            { id: task.id, sortOrder: b },
            { id: swapWith.id, sortOrder: a },
          ];

    try {
      await api.patch('/tasks/reorder', { items });
      await loadTasks();
    } catch (err) {
      setError(err.userMessage);
    }
  };

  const doCopy = async () => {
    setSaving(true);
    try {
      await api.post('/tasks/copy', {
        fromOutletId: Number(copyFrom),
        toOutletId: Number(locationId),
      });
      setCopyOpen(false);
      await loadTasks();
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  }

  const f = (k) => (e) =>
    setForm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <div className="page-body">
      <div className="page-head">
        <h1>{t('tasks')}</h1>
        <div className="filters">
          <select value={locationId} onChange={(e) => setOutletId(e.target.value)}>
            {locations.map((o) => (
              <option key={o.id} value={o.id}>
                {pick(o, 'name')} ({o.taskCount} {t('taskCount')})
              </option>
            ))}
          </select>
          <button className="btn ghost sm" onClick={() => setCopyOpen(true)}>
            {t('copyTasks')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            style={{ display: 'none' }}
            onChange={(e) => doImport(e.target.files?.[0])}
          />
          <button
            className="btn ghost sm"
            onClick={() => fileInput.current?.click()}
            disabled={importing}
            title={t('importHint')}
          >
            {importing ? <Spinner small /> : t('importExcel')}
          </button>
          <button className="btn primary sm" onClick={openNew}>
            + {t('add')}
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {importResult && (
        <div className="alert ok import-result">
          <div>
            <strong>
              {importResult.tasksCreated} {t('tasksImported')}
            </strong>{' '}
            <span className="muted small">
              ({importResult.sheet} · {importResult.rowsRead} {t('rowsRead')})
            </span>
            <button className="link-btn" onClick={() => setImportResult(null)}>
              {t('dismiss')}
            </button>
          </div>

          {importResult.locationsCreated.length > 0 && (
            <div className="small">
              {t('locationsAdded')}: {importResult.locationsCreated.join(', ')}
            </div>
          )}
          {importResult.subLocationsCreated.length > 0 && (
            <div className="small">
              {t('subLocationsAdded')}: {importResult.subLocationsCreated.join(', ')}
            </div>
          )}
          {importResult.withoutArabic > 0 && (
            <div className="small">
              {importResult.withoutArabic} {t('usedEnglishForArabic')}
            </div>
          )}
          {/* Rows already in the checklist. Expected when re-uploading a
              corrected sheet, but also how a repeated line in the source
              becomes visible instead of silently vanishing. */}
          {importResult.duplicatesSkipped.length > 0 && (
            <details className="small">
              <summary>
                {importResult.duplicatesSkipped.length} {t('alreadyExisted')}
              </summary>
              <ul className="plain-list">
                {importResult.duplicatesSkipped.map((d, i) => (
                  <li key={i}>
                    {t('row')} {d.row}: “{d.title}” — {d.subLocation || '—'}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {importResult.rowsSkipped.length > 0 && (
            <details className="small">
              <summary>
                {importResult.rowsSkipped.length} {t('rowsCouldNotBeRead')}
              </summary>
              <ul className="plain-list">
                {importResult.rowsSkipped.map((s, i) => (
                  <li key={i}>
                    {t('row')} {s.row}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {grouped.length === 0 && <p className="muted center-block">—</p>}

      {grouped.map((g) => (
        <section className="panel" key={g.id ?? 0}>
          <h3>
            {g.icon} {pick(g, 'name')}{' '}
            <span className="muted small">({g.items.length})</span>
          </h3>
          <ul className="admin-task-list">
            {g.items.map((task, i) => (
              <li key={task.id}>
                <div className="atl-main">
                  <div>
                    <div className="atl-title">
                      {task.descriptionEn}
                      {task.isCritical && <span className="tag danger sm">{t('critical')}</span>}
                      {task.frequency !== 'every_shift' && (
                        <span className="tag sm">{t(task.frequency)}</span>
                      )}
                      {task.shiftCode && <span className="tag warn sm">{task.shiftCode}</span>}
                      {task.requiresPhoto && <span className="tag sm">📷</span>}
                    </div>
                    <div className="muted small rtl-text">{task.descriptionAr}</div>
                  </div>
                  <div className="atl-actions">
                    <button className="icon-btn sm" disabled={i === 0} onClick={() => move(task, -1)} title={t('moveUp')}>
                      ↑
                    </button>
                    <button
                      className="icon-btn sm"
                      disabled={i === g.items.length - 1}
                      onClick={() => move(task, 1)}
                      title={t('moveDown')}
                    >
                      ↓
                    </button>
                    <button className="btn ghost sm" onClick={() => openEdit(task)}>
                      {t('edit')}
                    </button>
                    <button className="btn ghost sm danger" onClick={() => remove(task)}>
                      {t('delete')}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {editing && (
        <Modal
          title={editing.id ? t('edit') : t('add')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>
                {t('cancel')}
              </button>
              <button
                className="btn primary"
                onClick={save}
                disabled={saving || !form.descriptionEn.trim() || !form.descriptionAr.trim()}
              >
                {saving ? <Spinner small /> : t('save')}
              </button>
            </>
          }
        >
          <label className="field">
            <span>{t('subLocation')}</span>
            <select value={form.subLocationId} onChange={f('subLocationId')}>
              <option value="">—</option>
              {subLocations.map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c, 'name')}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>{t('descriptionEn')}</span>
            <input value={form.descriptionEn} onChange={f('descriptionEn')} />
          </label>

          <label className="field">
            <span>{t('descriptionAr')}</span>
            <input value={form.descriptionAr} onChange={f('descriptionAr')} dir="rtl" />
          </label>

          <label className="field">
            <span>{t('descEn')}</span>
            <textarea rows={2} value={form.notesEn} onChange={f('notesEn')} />
          </label>

          <label className="field">
            <span>{t('descAr')}</span>
            <textarea rows={2} value={form.notesAr} onChange={f('notesAr')} dir="rtl" />
          </label>

          <label className="field">
            <span>{t('frequency')}</span>
            <select value={form.frequency} onChange={f('frequency')}>
              <option value="every_shift">{t('every_shift')}</option>
              <option value="daily">{t('daily')}</option>
              <option value="weekly">{t('weekly')}</option>
            </select>
          </label>

          <label className="field">
            <span>{t('whichShift')}</span>
            <select value={form.shiftTypeId} onChange={f('shiftTypeId')}>
              <option value="">{t('allShiftsOption')}</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {pick(s, 'name')} ({s.startTime}–{s.endTime})
                </option>
              ))}
            </select>
            <span className="muted small">{t('shiftHint')}</span>
          </label>

          <label className="check">
            <input type="checkbox" checked={form.isCritical} onChange={f('isCritical')} />
            <span>{t('markCritical')}</span>
          </label>

          <label className="check">
            <input type="checkbox" checked={form.requiresPhoto} onChange={f('requiresPhoto')} />
            <span>{t('requirePhoto')}</span>
          </label>
        </Modal>
      )}

      {copyOpen && (
        <Modal
          title={t('copyTasks')}
          onClose={() => setCopyOpen(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setCopyOpen(false)}>
                {t('cancel')}
              </button>
              <button className="btn primary" onClick={doCopy} disabled={!copyFrom || saving}>
                {saving ? <Spinner small /> : t('copy')}
              </button>
            </>
          }
        >
          <label className="field">
            <span>{t('copyFrom')}</span>
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">—</option>
              {locations
                .filter((o) => String(o.id) !== locationId)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {pick(o, 'name')} ({o.taskCount})
                  </option>
                ))}
            </select>
          </label>
          <p className="muted small">
            Tasks are added to the current location. Existing tasks are not removed.
          </p>
        </Modal>
      )}
    </div>
  );
}
