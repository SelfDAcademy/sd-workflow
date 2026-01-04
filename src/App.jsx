import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Header from "./Header";

import TasksPage from "./pages/TasksPage";
import ProjectsPage from "./pages/ProjectsPage";
import WorklogPage from "./pages/WorklogPage";
import LoginPage from "./pages/LoginPage";

import RequireAuth from "./auth/RequireAuth";
import { TaskProvider } from "./TaskStore";
import ResetPassword from "./pages/ResetPassword";

function App() {
  return (
    <TaskProvider>
      <BrowserRouter>
        <Header />

        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route
            path="/*"
            element={
              <RequireAuth>
                <Routes>
                  <Route path="/" element={<Navigate to="/tasks" />} />
                  <Route path="/tasks" element={<TasksPage />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/worklog" element={<WorklogPage />} />
                </Routes>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </TaskProvider>
  );
}

export default App;
