import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { useLang } from './i18n.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Locations from './pages/Locations.jsx';
import Checklist from './pages/Checklist.jsx';
import Spinner from './components/Spinner.jsx';

export default function App() {
  const { user, loading } = useAuth();
  const { t } = useLang();

  if (loading) {
    return (
      <div className="center-screen">
        <Spinner />
        <p className="muted">{t('loading')}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // First sign-in: nothing else is reachable until they pick a password.
  if (user.mustChangePassword) {
    return (
      <Routes>
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/change-password" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Locations />} />
      <Route path="/location/:locationId" element={<Checklist />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
