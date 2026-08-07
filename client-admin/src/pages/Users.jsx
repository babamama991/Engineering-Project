import { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useLang } from '../i18n.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import Spinner from '../components/Spinner.jsx';

const blank = {
  username: '',
  fullName: '',
  password: '',
  role: 'staff',
  jobTitle: '',
  phone: '',
  preferredLang: 'en',
  mustChangePassword: true,
};

export default function Users() {
  const { t } = useLang();
  const { isAdmin } = useAuth();
  // A HOD may only act on staff accounts. The API enforces this; the UI just
  // avoids showing buttons that would come back 403.
  const canManage = (u) => isAdmin || u.role === 'staff';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const [resetting, setResetting] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  const load = async () => {
    try {
      setRows((await api.get('/users', { params: { includeInactive: true } })).data);
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
      if (editing.id) {
        // Username and password are never changed through this form.
        await api.patch(`/users/${editing.id}`, {
          fullName: form.fullName,
          role: form.role,
          jobTitle: form.jobTitle || null,
          phone: form.phone || null,
          preferredLang: form.preferredLang,
        });
      } else {
        await api.post('/users', {
          username: form.username.trim(),
          fullName: form.fullName.trim(),
          password: form.password,
          role: form.role,
          jobTitle: form.jobTitle || null,
          phone: form.phone || null,
          preferredLang: form.preferredLang,
          mustChangePassword: form.mustChangePassword,
        });
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.patch(`/users/${u.id}`, { isActive: !u.isActive });
      await load();
    } catch (err) {
      setError(err.userMessage);
    }
  };

  const doReset = async () => {
    setSaving(true);
    try {
      await api.post(`/users/${resetting.id}/reset-password`, { newPassword });
      setResetting(null);
      setNewPassword('');
      await load();
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setSaving(false);
    }
  };

  const f = (k) => (e) =>
    setForm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  if (loading) return <div className="center-screen"><Spinner /></div>;

  return (
    <div className="page-body">
      <div className="page-head">
        <h1>{t('users')}</h1>
        <button className="btn primary sm" onClick={() => { setForm(blank); setEditing({}); }}>
          + {t('addStaff')}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <section className="panel">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('fullName')}</th>
                <th>{t('username')}</th>
                <th>{t('role')}</th>
                <th>{t('jobTitle')}</th>
                <th>{t('phone')}</th>
                <th>{t('lastLogin')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className={u.isActive ? '' : 'row-muted'}>
                  <td>
                    {u.fullName}
                    {u.mustChangePassword && <span className="tag warn sm">new</span>}
                    {!u.isActive && <span className="tag sm">{t('inactive')}</span>}
                  </td>
                  <td className="mono">@{u.username}</td>
                  <td>
                    <span
                      className={`tag sm ${
                        u.role === 'admin' ? 'danger' : u.role === 'hod' ? 'warn' : ''
                      }`}
                    >
                      {u.role === 'admin'
                        ? t('admin')
                        : u.role === 'hod'
                          ? t('hodRole')
                          : t('staffRole')}
                    </span>
                  </td>
                  <td>{u.jobTitle || '—'}</td>
                  <td className="mono nowrap">{u.phone || '—'}</td>
                  <td className="muted small nowrap">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : t('never')}
                  </td>
                  <td className="row-actions">
                    {canManage(u) ? (
                      <>
                        <button
                          className="btn ghost sm"
                          onClick={() => {
                            setForm({
                              ...blank,
                              fullName: u.fullName,
                              role: u.role,
                              jobTitle: u.jobTitle || '',
                              phone: u.phone || '',
                              preferredLang: u.preferredLang,
                            });
                            setEditing(u);
                          }}
                        >
                          {t('edit')}
                        </button>
                        <button className="btn ghost sm" onClick={() => setResetting(u)}>
                          {t('resetPassword')}
                        </button>
                        <button className="btn ghost sm" onClick={() => toggleActive(u)}>
                          {u.isActive ? t('deactivate') : t('activate')}
                        </button>
                      </>
                    ) : (
                      <span className="muted small">{t('itManagedOnly')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <Modal
          title={editing.id ? t('edit') : t('addStaff')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>{t('cancel')}</button>
              <button
                className="btn primary"
                onClick={save}
                disabled={
                  saving ||
                  !form.fullName.trim() ||
                  (!editing.id && (!form.username.trim() || form.password.length < 8))
                }
              >
                {saving ? <Spinner small /> : t('save')}
              </button>
            </>
          }
        >
          {!editing.id && (
            <label className="field">
              <span>{t('username')}</span>
              <input
                value={form.username}
                onChange={f('username')}
                placeholder="ahmad.k"
                autoCapitalize="none"
              />
            </label>
          )}

          <label className="field">
            <span>{t('fullName')}</span>
            <input value={form.fullName} onChange={f('fullName')} />
          </label>

          {!editing.id && (
            <>
              <label className="field">
                <span>{t('tempPassword')}</span>
                <input
                  type="text"
                  value={form.password}
                  onChange={f('password')}
                  placeholder="at least 8 characters"
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.mustChangePassword}
                  onChange={f('mustChangePassword')}
                />
                <span>{t('mustChange')}</span>
              </label>
            </>
          )}

          <label className="field">
            <span>{t('role')}</span>
            {isAdmin ? (
              <select value={form.role} onChange={f('role')}>
                <option value="staff">{t('staffRole')}</option>
                <option value="hod">{t('hodRole')}</option>
                <option value="admin">{t('admin')}</option>
              </select>
            ) : (
              // A HOD creates technicians and nothing else, so there is no
              // choice to present — showing a locked field explains why.
              <input value={t('staffRole')} disabled readOnly />
            )}
            {!isAdmin && <span className="muted small">{t('hodCanAddStaffOnly')}</span>}
          </label>

          <label className="field">
            <span>{t('jobTitle')}</span>
            <input value={form.jobTitle} onChange={f('jobTitle')} />
          </label>

          <label className="field">
            <span>{t('phone')}</span>
            <input value={form.phone} onChange={f('phone')} />
          </label>

          <label className="field">
            <span>Language</span>
            <select value={form.preferredLang} onChange={f('preferredLang')}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
        </Modal>
      )}

      {resetting && (
        <Modal
          title={`${t('resetPassword')} — ${resetting.fullName}`}
          onClose={() => setResetting(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setResetting(null)}>{t('cancel')}</button>
              <button
                className="btn primary"
                onClick={doReset}
                disabled={saving || newPassword.length < 8}
              >
                {saving ? <Spinner small /> : t('save')}
              </button>
            </>
          }
        >
          <label className="field">
            <span>{t('newPassword')}</span>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="at least 8 characters"
            />
          </label>
          <p className="muted small">{t('mustChange')}</p>
        </Modal>
      )}
    </div>
  );
}
