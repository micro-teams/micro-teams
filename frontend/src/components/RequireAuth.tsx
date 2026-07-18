import { Navigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, booting } = useAuth();
  if (booting) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
