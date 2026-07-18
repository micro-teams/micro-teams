// Team management on desktop. The phone already has full team management
// (ManagePage = list + create, TeamManagePage = rename / members / danger, and
// the latter reads its teamId from the route). Rather than rebuild it, host those
// exact pages in a nested <Routes> so their useParams() resolves — they render as
// a centered column in the desktop main area with their own back button. Reached
// from the docs team-switcher's "Manage teams".
//
// Paths are RELATIVE (no leading slash): this <Routes> is a descendant of the
// DesktopApp `/*` splat route, so it matches the URL relative to "/".
import { Routes, Route, Navigate } from "react-router";
import { ManagePage } from "@/pages/ManagePage";
import { TeamManagePage } from "@/pages/TeamManagePage";

export function TeamsManageDesktop() {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <Routes>
        <Route path="teams/manage" element={<ManagePage />} />
        <Route path="teams/manage/:teamId" element={<TeamManagePage />} />
        <Route path="*" element={<Navigate to="/teams" replace />} />
      </Routes>
    </div>
  );
}
