import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => {
    localStorage.removeItem('sv_admin_token');
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clear);
  }, [clear]);

  useEffect(() => {
    (async () => {
      if (!localStorage.getItem('sv_admin_token')) return setLoading(false);
      try {
        const { data } = await api.get('/auth/me');
        setUser(data.user);
      } catch {
        clear();
      } finally {
        setLoading(false);
      }
    })();
  }, [clear]);

  const login = useCallback(async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    // Admins and HODs both belong here; technicians use the staff app. This is
    // a convenience gate only — the API enforces the real boundaries per route.
    if (data.user.role !== 'admin' && data.user.role !== 'hod') {
      throw Object.assign(new Error('not a manager'), {
        userMessage: 'This account is not an admin or HOD. Use the staff app instead.',
      });
    }
    localStorage.setItem('sv_admin_token', data.token);
    setUser(data.user);
    return data.user;
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout: clear, isAdmin: user?.role === 'admin' }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
