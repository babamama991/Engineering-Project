import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n.jsx';

// adminOnly entries are hidden from HODs. The API blocks them regardless —
// hiding them just avoids offering a door that won't open.
const NAV = [
  { to: '/', key: 'dashboard', icon: '📊', end: true },
  { to: '/reports', key: 'reports', icon: '📄' },
  { to: '/roster', key: 'roster', icon: '🗓️' },
  { to: '/tasks', key: 'tasks', icon: '✅' },
  { to: '/locations', key: 'locations', icon: '🏢' },
  { to: '/sub-locations', key: 'subLocations', icon: '🏷️' },
  { to: '/users', key: 'users', icon: '👷' },
  { to: '/settings', key: 'settings', icon: '⚙️', adminOnly: true },
];

export default function Layout({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const { t, lang, setLang } = useLang();
  const [open, setOpen] = useState(false);

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">SV</div>
          <div>
            <div className="brand-name">{t('hotel')}</div>
            <div className="brand-sub">{t('adminPanel')}</div>
          </div>
        </div>

        <nav>
          {NAV.filter((item) => isAdmin || !item.adminOnly).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{t(item.key)}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="who">
            <div className="who-name">{user.fullName}</div>
            <div className="who-role">
              @{user.username} · {isAdmin ? t('admin') : t('hodRole')}
            </div>
          </div>
          <div className="foot-actions">
            <button
              className="btn ghost sm"
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
            >
              {lang === 'en' ? 'ع' : 'EN'}
            </button>
            <button className="btn ghost sm" onClick={logout}>
              {t('signOut')}
            </button>
          </div>
        </div>
      </aside>

      {/* Tapping the dimmed area closes the drawer on phones. */}
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setOpen((o) => !o)} aria-label="menu">
            ☰
          </button>
          <span className="topbar-title">{t('adminPanel')}</span>
        </header>
        <div className="main-content">{children}</div>
      </div>
    </div>
  );
}
