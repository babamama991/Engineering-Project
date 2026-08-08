import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Spinner from './components/Spinner.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Reports from './pages/Reports.jsx';
import Roster from './pages/Roster.jsx';
import Tasks from './pages/Tasks.jsx';
import Locations from './pages/Locations.jsx';
import SubLocations from './pages/SubLocations.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="center-screen">
        <Spinner />
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

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/roster" element={<Roster />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/sub-locations" element={<SubLocations />} />
        <Route path="/users" element={<Users />} />
        {/* Settings is IT-only. Hiding the nav link isn't enough — someone can
            type the URL — so the route itself is gone for a HOD. */}
        <Route
          path="/settings"
          element={isAdmin ? <Settings /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
