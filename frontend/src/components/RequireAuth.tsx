import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, booting } = useAuth();
  const location = useLocation();
  if (booting) return null;
  if (!user)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  return <>{children}</>;
}
