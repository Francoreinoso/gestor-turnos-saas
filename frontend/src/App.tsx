import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { roleHome } from './utils/token';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import BookingPage from './pages/BookingPage';
import ManagePage from './pages/ManagePage';
import ServicesPage from './pages/ServicesPage';
import StaffPage from './pages/StaffPage';
import SchedulePage from './pages/SchedulePage';
import ActivatePage from './pages/ActivatePage';

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user ? <Navigate to={roleHome(user.role)} replace /> : <>{children}</>;
}

function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'owner') return <Navigate to="/staff/agenda" replace />;
  return <>{children}</>;
}

function StaffRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'staff') return <Navigate to="/owner/agenda" replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? roleHome(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login"        element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/owner/agenda" element={<OwnerRoute><DashboardPage /></OwnerRoute>} />
          <Route path="/staff/agenda" element={<StaffRoute><DashboardPage /></StaffRoute>} />
          {/* spec 009 RF-3: pantallas de gestión, con la misma guarda por rol que las agendas */}
          <Route path="/owner/servicios" element={<OwnerRoute><ServicesPage /></OwnerRoute>} />
          <Route path="/owner/equipo" element={<OwnerRoute><StaffPage /></OwnerRoute>} />
          <Route path="/owner/equipo/:id/horario" element={<OwnerRoute><SchedulePage /></OwnerRoute>} />
          <Route path="/staff/horario" element={<StaffRoute><SchedulePage /></StaffRoute>} />
          {/* spec 009 RF-25: pública, con o sin sesión y sin redirigir por rol */}
          <Route path="/activar" element={<ActivatePage />} />
          {/* spec 005 RF-32: públicas, con o sin sesión y sin redirigir por rol */}
          <Route path="/reservar/:accountId" element={<BookingPage />} />
          <Route path="/turno/:id"    element={<ManagePage />} />
          <Route path="*"             element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
