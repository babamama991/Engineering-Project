import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [shift, setShift] = useState(null);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => {
    localStorage.removeItem('sv_token');
    setUser(null);
    setShift(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => clear());
  }, [clear]);

  const refresh = useCallback(async () => {
    if (!localStorage.getItem('sv_token')) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      setShift(data.shift || null);
      return data.user;
    } catch (err) {
      // 428 = password change required; the user is valid, just gated.
      if (err.response?.status === 428) return null;
      clear();
      return null;
    } finally {
      setLoading(false);
    }
  }, [clear]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    localStorage.setItem('sv_token', data.token);
    setUser(data.user);
    if (!data.user.mustChangePassword) await refresh();
    return data.user;
  }, [refresh]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await api.post('/auth/change-password', { currentPassword, newPassword });
    setUser((u) => ({ ...u, mustChangePassword: false }));
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider
      value={{ user, shift, loading, login, logout: clear, refresh, changePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
