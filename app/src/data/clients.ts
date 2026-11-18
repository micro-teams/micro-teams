/*
 * The installable clients this deployment offers, as the deployment itself lists them in
 * /downloads/clients.json (written by CI beside the packages, so the list and the files agree).
 *
 * useClientPackages() → { packages, loaded } — each { platform, url, bytes, signed }; empty when
 *   the deployment ships none, or the list cannot be read (an ordinary state, not an error).
 *
 * Example: const { packages } = useClientPackages();
 *
 * Fetched directly, not over the substrate: a download is one large file the browser or the
 * system's download manager fetches, and it is the one thing that does not ride the lines.
 */
import { useQuery } from "@tanstack/react-query";
import { useSession } from "./session";

export type ClientPackage = { platform: string; arch?: string; url: string; bytes: number; signed: string };

export function useClientPackages() {
  const { origin } = useSession();
  const q = useQuery({
    queryKey: ["client-packages", origin],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClientPackage[]> => {
      try {
        const res = await fetch(`${origin}/downloads/clients.json`);
        if (!res.ok) return [];
        const body = (await res.json()) as { clients?: ClientPackage[] };
        return (body.clients ?? []).filter((c) => typeof c.url === "string" && c.url);
      } catch {
        return [];
      }
    },
  });
  return { packages: q.data ?? [], loaded: q.isFetched };
}
