import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RoleGuard } from './auth/RoleGuard';
import { Login } from './pages/Login';
import { PatientPanel } from './pages/PatientPanel';
import { PatientDetail } from './pages/PatientDetail';
import { Population } from './pages/Population';
import { PopulationPatientList } from './pages/PopulationPatientList';
import { Governance } from './pages/Governance';
import { Quality } from './pages/Quality';
import { Team } from './pages/Team';
import { Sdoh } from './pages/Sdoh';
import { TaskQueue } from './pages/TaskQueue';
import { TaskDetail } from './pages/TaskDetail';
import { ComingSoon } from './pages/ComingSoon';
import { ShellScreenPage } from './pages/ShellScreenPage';
import { MoreScreens } from './pages/MoreScreens';
import { SHELL_SCREENS } from './lib/shellScreens';

// S11 B1 — W13 is folded into the shared GD9 shell pattern (see
// shellScreens.ts) but keeps its own pre-existing `/task-center` route and
// Coordinator-only nav link (AppShell.tsx) rather than the generic
// `/screens/:screenId` route below, so neither regresses.
const TASK_CENTER_LABEL = SHELL_SCREENS.find((s) => s.id === 'W13')!.label;

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RoleGuard>
            <AppShell />
          </RoleGuard>
        }
      >
        <Route path="/panel" element={<PatientPanel />} />
        <Route path="/patients/:id" element={<PatientDetail />} />
        {/* S11 A1 — M05 SDOH resource directory + referral; every role with
            'sdoh' scope (director/coordinator/social_worker — see
            auth/scopes.ts) can reach it, so no extra RoleGuard here. */}
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
          path="/population/patients"
          element={
            <RoleGuard role="director">
              <PopulationPatientList />
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
        <Route path="/coming-soon" element={<ComingSoon />} />
        {/* S11 B1 — one dynamic route for the 10 remaining GD9 shell screens
            (W13 has its own /task-center route above), not 11 static
            entries; see lib/shellScreens.ts. */}
        <Route path="/screens/:screenId" element={<ShellScreenPage />} />
        <Route path="/more" element={<MoreScreens />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
