import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n.jsx';
import Spinner from '../components/Spinner.jsx';

export default function Login() {
  const { login } = useAuth();
  const { t, lang, setLang } = useLang();
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
      setError(err.userMessage || 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <button className="lang-toggle login-lang" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
        {lang === 'en' ? 'ع' : 'EN'}
      </button>

      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="login-logo">SV</div>
          <h1>{t('hotel')}</h1>
          <p className="muted">{t('adminPanel')}</p>
        </div>

        <label className="field">
          <span>{t('username')}</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
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

        <button className="btn primary block" disabled={busy}>
          {busy ? <Spinner small /> : t('signIn')}
        </button>
      </form>
    </div>
  );
}
