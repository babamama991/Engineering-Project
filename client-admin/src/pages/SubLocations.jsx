import { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useLang } from '../i18n.jsx';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';

const blank = { nameEn: '', nameAr: '', icon: '', sortOrder: 0, isActive: true };

export default function SubLocations() {
  const { t } = useLang();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setRows((await api.get('/sub-locations')).data);
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
      const payload = { ...form, sortOrder: Number(form.sortOrder) || 0, icon: form.icon || null };
      if (editing.id) await api.patch(`/sub-locations/${editing.id}`, payload);
      else await api.post('/sub-locations', payload);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`${t('confirmDelete')}\n\n${c.nameEn}`)) return;
    try {
      const { data } = await api.delete(`/sub-locations/${c.id}`);
      if (data.tasksAffected) {
        window.alert(`${data.tasksAffected} task(s) are now uncategorised.`);
      }
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
        <h1>{t('subLocations')}</h1>
        <button className="btn primary sm" onClick={() => { setForm(blank); setEditing({}); }}>
          + {t('add')}
        </button>
      </div>

      <p className="muted small">
        SubLocations are shared across all locations — define “Electrical” once and use it everywhere.
      </p>

      {error && <div className="alert error">{error}</div>}

      <section className="panel">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('order')}</th>
                <th>{t('icon')}</th>
                <th>{t('nameEn')}</th>
                <th>{t('nameAr')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.sortOrder}</td>
                  <td>{c.icon}</td>
                  <td>{c.nameEn}</td>
                  <td className="rtl-text">{c.nameAr}</td>
                  <td className="row-actions">
                    <button
                      className="btn ghost sm"
                      onClick={() => {
                        setForm({
                          nameEn: c.nameEn, nameAr: c.nameAr, icon: c.icon || '',
                          sortOrder: c.sortOrder, isActive: c.isActive,
                        });
                        setEditing(c);
                      }}
                    >
                      {t('edit')}
                    </button>
                    <button className="btn ghost sm danger" onClick={() => remove(c)}>
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
                disabled={saving || !form.nameEn.trim() || !form.nameAr.trim()}
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
            <span>{t('icon')}</span>
            <input value={form.icon} onChange={f('icon')} placeholder="⚡" maxLength={4} />
          </label>
          <label className="field">
            <span>{t('order')}</span>
            <input type="number" value={form.sortOrder} onChange={f('sortOrder')} />
          </label>
        </Modal>
      )}
    </div>
  );
}
