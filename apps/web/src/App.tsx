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
import { TaskManagement } from './pages/TaskManagement';
import { CarePlanBuilder } from './pages/CarePlanBuilder';
import { PatientProfile } from './pages/PatientProfile';
import { ComingSoon } from './pages/ComingSoon';
import { ShellScreenPage } from './pages/ShellScreenPage';
import { MoreScreens } from './pages/MoreScreens';
import AlertsPage from './pages/AlertsPage';
import SettingsPage from './pages/SettingsPage';
import CostROI from './pages/CostROI';

// S12 C.1 — `/task-center` now points at the real `TaskManagement` page
// (the W13 task-management center, ported from the lead project) rather
// than the S11 `ComingSoon` placeholder.

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
        <Route path="/panel" element={<RoleGuard role="coordinator"><PatientPanel /></RoleGuard>} />
        <Route path="/patients/:id" element={<PatientDetail />} />
        <Route path="/patients/:id/profile" element={<PatientProfile />} />
        <Route path="/patients/:id/sdoh" element={<Sdoh />} />
        <Route path="/tasks" element={<TaskQueue />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        {/* S12 C.2 — Care Plan Builder (W14, capacity-flexed in S11 A4, now built). */}
        <Route
          path="/care-plans/:patientId"
          element={
            <RoleGuard role="coordinator">
              <CarePlanBuilder />
            </RoleGuard>
          }
        />
        <Route path="/task-center" element={<RoleGuard role="coordinator"><TaskManagement /></RoleGuard>} />
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
