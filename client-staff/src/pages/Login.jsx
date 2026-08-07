import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n.jsx';
import LangToggle from '../components/LangToggle.jsx';
import Spinner from '../components/Spinner.jsx';

export default function Login() {
  const { login } = useAuth();
  const { t } = useLang();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.userMessage || t('wrongLogin'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-lang">
        <LangToggle />
      </div>

      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="login-logo">SV</div>
          <h1>{t('hotel')}</h1>
          <p className="muted">{t('appName')}</p>
        </div>

        <label className="field">
          <span>{t('username')}</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            required
          />
        </label>

        <label className="field">
          <span>{t('password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <div className="alert error">{error}</div>}

        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? (
            <>
              <Spinner small /> {t('signingIn')}
            </>
          ) : (
            t('signIn')
          )}
        </button>
      </form>
    </div>
  );
}
