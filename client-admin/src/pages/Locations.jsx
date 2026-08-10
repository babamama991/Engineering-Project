import { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useLang } from '../i18n.jsx';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';

const blank = { nameEn: '', nameAr: '', location: '', sortOrder: 0, isActive: true };

export default function Locations() {
  const { t, pick } = useLang();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/locations', { params: { includeInactive: true } });
      setRows(data);
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, sortOrder: Number(form.sortOrder) || 0 };
      if (editing.id) await api.patch(`/locations/${editing.id}`, payload);
      else await api.post('/locations', payload);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (o) => {
    if (!window.confirm(`${t('confirmDelete')}\n\n${o.nameEn}`)) return;
    try {
      await api.delete(`/locations/${o.id}`);
      await load();
    } catch (err) {
      setError(err.userMessage);
    }
  };

  const f = (k) => (e) =>
    setForm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  if (loading) return <div className="center-screen"><Spinner /></div>;

  return (
    <div className="page-body">
      <div className="page-head">
        <h1>{t('locations')}</h1>
        <button className="btn primary sm" onClick={() => { setForm(blank); setEditing({}); }}>
          + {t('add')}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <section className="panel">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('order')}</th>
                <th>{t('nameEn')}</th>
                <th>{t('nameAr')}</th>
                <th>{t('locationDetail')}</th>
                <th>{t('tasks')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className={o.isActive ? '' : 'row-muted'}>
                  <td className="mono">{o.sortOrder}</td>
                  <td>{o.nameEn}</td>
                  <td className="rtl-text">{o.nameAr}</td>
                  <td>{o.location || '—'}</td>
                  <td className="mono">{o.taskCount}</td>
                  <td className="row-actions">
                    <button
                      className="btn ghost sm"
                      onClick={() => {
                        setForm({
                          nameEn: o.nameEn, nameAr: o.nameAr,
                          location: o.location || '', sortOrder: o.sortOrder, isActive: o.isActive,
                        });
                        setEditing(o);
                      }}
                    >
                      {t('edit')}
                    </button>
                    <button className="btn ghost sm danger" onClick={() => remove(o)}>
                      {t('delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <Modal
          title={editing.id ? t('edit') : t('add')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>{t('cancel')}</button>
              <button
                className="btn primary"
                onClick={save}
                disabled={saving || !form.nameEn.trim()}
              >
                {saving ? <Spinner small /> : t('save')}
              </button>
            </>
          }
        >
          <label className="field">
            <span>{t('nameEn')}</span>
            <input value={form.nameEn} onChange={f('nameEn')} />
          </label>
          <label className="field">
            <span>{t('nameAr')}</span>
            <input value={form.nameAr} onChange={f('nameAr')} dir="rtl" />
          </label>
          <label className="field">
            <span>{t('locationDetail')}</span>
            <input value={form.location} onChange={f('location')} />
          </label>
          <label className="field">
            <span>{t('order')}</span>
            <input type="number" value={form.sortOrder} onChange={f('sortOrder')} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.isActive} onChange={f('isActive')} />
            <span>{t('active')}</span>
          </label>
        </Modal>
      )}
    </div>
  );
}
