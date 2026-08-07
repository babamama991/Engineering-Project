import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n.jsx';
import Spinner from '../components/Spinner.jsx';

export default function ChangePassword() {
  const { user, changePassword, logout } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) return setError(t('passwordsDontMatch'));
    setBusy(true);
    try {
      await changePassword(current, next);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.userMessage);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1 className="card-title">{t('changePassword')}</h1>
        {user?.mustChangePassword && <p className="muted">{t('changePasswordHint')}</p>}

        <label className="field">
          <span>{t('currentPassword')}</span>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <label className="field">
          <span>{t('newPassword')}</span>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>

        <label className="field">
          <span>{t('confirmPassword')}</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>

        {error && <div className="alert error">{error}</div>}

        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? <Spinner small /> : t('update')}
        </button>
        <button type="button" className="btn ghost block" onClick={logout}>
          {t('signOut')}
        </button>
      </form>
    </div>
  );
}
