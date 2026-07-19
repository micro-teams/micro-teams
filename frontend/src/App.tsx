import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router";
import { AuthProvider } from "@/hooks/useAuth";
import { WorkspaceProvider } from "@/hooks/useWorkspace";
import { RequireAuth } from "@/components/RequireAuth";
import { MobileTabs } from "@/components/MobileTabs";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { ManagePage } from "@/pages/ManagePage";
import { TeamManagePage } from "@/pages/TeamManagePage";
import { FilePage } from "@/pages/FilePage";
import { NewChatPage } from "@/pages/NewChatPage";
import { ThreadPage } from "@/pages/ThreadPage";
import { ChatInfoPage } from "@/pages/ChatInfoPage";
import { ConnectPage } from "@/pages/ConnectPage";
import { AgentPresenceProvider } from "@/hooks/useAgentPresence";
import { SceneProvider } from "@/hooks/useScene";
import { SceneOverlay } from "@/components/SceneOverlay";
import { ToastProvider } from "@/hooks/useToast";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { DesktopShell } from "@/desktop/DesktopShell";

// Detail routes render without the bottom tab bar (they carry their own back
// button) — the mobile "push a screen" pattern.
function FullScreen() {
  return (
    <div className="min-h-svh">
      <Outlet />
    </div>
  );
}

// The signed-in providers, shared by both shells: one WorkspaceProvider so the
// selected team / expanded folders / doc-tree cache survive navigation, agent
// presence + the one app-global 现场 viewer overlay.
function Authed({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AgentPresenceProvider>
        <SceneProvider>
          {children}
          {/* One app-global 现场 viewer, opened by any agent avatar. */}
          <SceneOverlay />
        </SceneProvider>
      </AgentPresenceProvider>
    </RequireAuth>
  );
}

// --- Phone shell: bottom tabs + full-screen detail pushes (unchanged) --------
function MobileApp() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        element={
          <Authed>
            <WorkspaceProvider />
          </Authed>
        }
      >
        <Route index element={<Navigate to="/chats" replace />} />

        {/* Tabbed list views share ONE keep-alive bottom-nav shell: MobileTabs
            stays mounted across these paths and hides (never unmounts) the
            inactive tabs, so each tab keeps its scroll / selection / inputs. */}
        <Route element={<MobileTabs />}>
          <Route path="/teams" element={null} />
          <Route path="/chats" element={null} />
          <Route path="/agents" element={null} />
          <Route path="/profile" element={null} />
        </Route>

        {/* Detail views push full-screen. */}
        <Route element={<FullScreen />}>
          <Route path="/teams/manage" element={<ManagePage />} />
          <Route path="/teams/manage/:teamId" element={<TeamManagePage />} />
          <Route path="/teams/:teamId/file" element={<FilePage />} />
          <Route path="/chats/new" element={<NewChatPage />} />
          <Route path="/chats/:threadId" element={<ThreadPage />} />
          <Route path="/chats/:threadId/info" element={<ChatInfoPage />} />
          <Route path="/connect" element={<ConnectPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/chats" replace />} />
    </Routes>
  );
}

// --- Desktop shell: 64px rail + master-detail panes (same URLs) --------------
// The desktop shell reads the URL itself and renders master-detail, so the whole
// signed-in area is one route; WorkspaceProvider wraps it as a plain provider.
function DesktopApp() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/connect"
        element={
          <Authed>
            <ConnectPage />
          </Authed>
        }
      />
      <Route
        path="/*"
        element={
          <Authed>
            <WorkspaceProvider>
              <DesktopShell />
            </WorkspaceProvider>
          </Authed>
        }
      />
    </Routes>
  );
}

function App() {
  const isDesktop = useIsDesktop();
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          {isDesktop ? <DesktopApp /> : <MobileApp />}
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
