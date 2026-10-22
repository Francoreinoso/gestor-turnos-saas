import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleHome } from '../utils/token';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario',
  staff: 'Staff',
};

// spec 009 RF-2 — encabezado del panel: enlaces por rol y "Salir". NavLink marca la página actual con aria-current.
export default function AppNav() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const links = user.role === 'owner'
    ? [
        { to: roleHome('owner'), label: 'Agenda' },
        { to: '/owner/pagos', label: 'Pagos' },
        { to: '/owner/servicios', label: 'Servicios' },
        { to: '/owner/equipo', label: 'Equipo' },
      ]
    : [
        { to: roleHome('staff'), label: 'Agenda' },
        { to: '/staff/pagos', label: 'Pagos' },
        { to: '/staff/horario', label: 'Mi horario' },
      ];

  return (
    <header className="dash-header app-nav">
      <span className="dash-role">{ROLE_LABEL[user.role] ?? ''}</span>
      <nav aria-label="Principal" className="app-nav-links">
        {links.map(l => <NavLink key={l.to} to={l.to}>{l.label}</NavLink>)}
      </nav>
      <button onClick={logout} className="dash-logout">Salir</button>
    </header>
  );
}
