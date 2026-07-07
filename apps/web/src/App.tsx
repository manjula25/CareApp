import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RoleGuard } from './auth/RoleGuard';
import { Login } from './pages/Login';
import { PatientPanel } from './pages/PatientPanel';
import { PatientDetail } from './pages/PatientDetail';
import { Population } from './pages/Population';
import { PopulationPatientList } from './pages/PopulationPatientList';
import { Governance } from './pages/Governance';
import { Sdoh } from './pages/Sdoh';
import { TaskQueue } from './pages/TaskQueue';
import { TaskDetail } from './pages/TaskDetail';
import { TaskCenter } from './pages/TaskCenter';
import { ComingSoon } from './pages/ComingSoon';

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
        <Route path="/task-center" element={<TaskCenter />} />
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
        <Route path="/coming-soon" element={<ComingSoon />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
