/*
 * The installable clients this deployment offers, as the deployment itself lists them in
 * /downloads/clients.json (written by CI beside the packages, so the list and the files agree).
 *
 * useClientPackages() → { packages, loaded } — each { platform, url, bytes, signed }; empty when
 *   the deployment ships none, or the list cannot be read (an ordinary state, not an error).
 *
 * ClientPackage — one installable client in clients.json: platform, arch, url, size, and whether
 *   it is release- or debug-signed.
 *
 * Example: const { packages } = useClientPackages();
 *
 * The list rides the lines; the download it links to does not — one large file is the browser's
 * or the system's download manager's to fetch.
 */
import { useQuery } from "@tanstack/react-query";
import { useSession } from "./session";

export type ClientPackage = { platform: string; arch?: string; url: string; bytes: number; signed: string };

export function useClientPackages() {
  const { origin, substrate } = useSession();
  const q = useQuery({
    queryKey: ["client-packages", origin],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClientPackage[]> => {
      try {
        const res = await substrate.fetch(`${origin}/downloads/clients.json`);
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
