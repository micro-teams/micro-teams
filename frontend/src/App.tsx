import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router";
import { AuthProvider } from "@/hooks/useAuth";
import { WorkspaceProvider } from "@/hooks/useWorkspace";
import { RequireAuth } from "@/components/RequireAuth";
import { AppLayout } from "@/components/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { ManagePage } from "@/pages/ManagePage";
import { TeamManagePage } from "@/pages/TeamManagePage";
import { FilePage } from "@/pages/FilePage";
import { ChatsPage } from "@/pages/ChatsPage";
import { NewChatPage } from "@/pages/NewChatPage";
import { ThreadPage } from "@/pages/ThreadPage";
import { ChatInfoPage } from "@/pages/ChatInfoPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { AgentPresenceProvider } from "@/hooks/useAgentPresence";
import { SceneProvider } from "@/hooks/useScene";
import { SceneOverlay } from "@/components/SceneOverlay";
import { ToastProvider } from "@/hooks/useToast";

// Detail routes render without the bottom tab bar (they carry their own back
// button) — the mobile "push a screen" pattern.
function FullScreen() {
  return (
    <div className="min-h-svh">
      <Outlet />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* Whole signed-in area shares one WorkspaceProvider so the teams
              tab's state (selected team, expanded folders, scroll, cached
              tree) survives switching to chats/me and back. */}
            <Route
              element={
                <RequireAuth>
                  <AgentPresenceProvider>
                    <SceneProvider>
                      <WorkspaceProvider />
                      {/* One app-global 现场 viewer, opened by any agent avatar. */}
                      <SceneOverlay />
                    </SceneProvider>
                  </AgentPresenceProvider>
                </RequireAuth>
              }
            >
              {/* Tabbed list views share the bottom-nav shell. */}
              <Route element={<AppLayout />}>
                <Route index element={<Navigate to="/chats" replace />} />
                <Route path="/teams" element={<WorkspacePage />} />
                <Route path="/chats" element={<ChatsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
              </Route>

              {/* Detail views push full-screen. */}
              <Route element={<FullScreen />}>
                <Route path="/teams/manage" element={<ManagePage />} />
                <Route
                  path="/teams/manage/:teamId"
                  element={<TeamManagePage />}
                />
                <Route path="/teams/:teamId/file" element={<FilePage />} />
                <Route path="/chats/new" element={<NewChatPage />} />
                <Route path="/chats/:threadId" element={<ThreadPage />} />
                <Route
                  path="/chats/:threadId/info"
                  element={<ChatInfoPage />}
                />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/chats" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
