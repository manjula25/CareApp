import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RoleGuard } from './auth/RoleGuard';
import { useAuth, roleHome } from './auth/useAuth';
import { Login } from './pages/Login';
import { PatientPanel } from './pages/PatientPanel';
import { PatientDetail } from './pages/PatientDetail';
import { Population } from './pages/Population';
import { Governance } from './pages/Governance';
import { Quality } from './pages/Quality';
import { Team } from './pages/Team';
import { Sdoh } from './pages/Sdoh';
import { TaskQueue } from './pages/TaskQueue';
import { TaskDetail } from './pages/TaskDetail';
import { PatientProfile } from './pages/PatientProfile';
import { ComingSoon } from './pages/ComingSoon';
import { ShellScreenPage } from './pages/ShellScreenPage';
import { MoreScreens } from './pages/MoreScreens';
import { SHELL_SCREENS } from './lib/shellScreens';
import AlertsPage from './pages/AlertsPage';
import SettingsPage from './pages/SettingsPage';
import CostROI from './pages/CostROI';

// S11 B1 — W13 is folded into the shared GD9 shell pattern (see
// shellScreens.ts) but keeps its own pre-existing `/task-center` route and
// Coordinator-only nav link (AppShell.tsx) rather than the generic
// `/screens/:screenId` route below, so neither regresses.
const TASK_CENTER_LABEL = SHELL_SCREENS.find((s) => s.id === 'W13')!.label;

function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(user.role)} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RootRedirect />} />
      <Route
        element={
          <RoleGuard>
            <AppShell />
          </RoleGuard>
        }
      >
        <Route path="/panel" element={<PatientPanel />} />
        <Route path="/patients/:id" element={<PatientDetail />} />
        <Route path="/patients/:id/profile" element={<PatientProfile />} />
        <Route path="/patients/:id/sdoh" element={<Sdoh />} />
        <Route path="/tasks" element={<TaskQueue />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/task-center" element={<ComingSoon title={TASK_CENTER_LABEL} />} />
        <Route
          path="/population"
          element={
            <RoleGuard role="director">
              <Population />
            </RoleGuard>
          }
        />
        <Route
          path="/governance"
          element={
            <RoleGuard role="director">
              <Governance />
            </RoleGuard>
          }
        />
        <Route
          path="/quality"
          element={
            <RoleGuard role="director">
              <Quality />
            </RoleGuard>
          }
        />
        <Route
          path="/team"
          element={
            <RoleGuard role="director">
              <Team />
            </RoleGuard>
          }
        />
        <Route
          path="/cost-roi"
          element={
            <RoleGuard role="director">
              <CostROI />
            </RoleGuard>
          }
        />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/sdoh" element={<Sdoh />} />
        <Route path="/coming-soon" element={<ComingSoon />} />
        <Route path="/screens/:screenId" element={<ShellScreenPage />} />
        <Route path="/more" element={<MoreScreens />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
