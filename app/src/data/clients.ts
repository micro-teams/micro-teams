/*
 * The installable clients this deployment offers, as the deployment itself lists them in
 * /downloads/clients.json (written by CI beside the packages, so the list and the files agree).
 *
 * useClientPackages() → { packages, loaded, from } — each { platform, url, bytes, signed }; empty
 *   when the deployment ships none, or the list cannot be read (an ordinary state, not an error).
 *   from is where to download them now, the substrate's quickestLine(): { origin, id }, id null
 *   when it is the server's origin because no line has been measured yet. A package's address is
 *   `${from.origin}${p.url}`; every line leads to the same nginx, which serves /downloads/.
 *
 * ClientPackage — one installable client in clients.json: platform, arch, url, size, and whether
 *   it is release- or debug-signed.
 *
 * Example: const { packages, from } = useClientPackages(); const href = `${from.origin}${packages[0].url}`;
 *
 * The list rides the lines; the download it links to goes to the browser's or the system's
 * download manager, over the one line that answers fastest: one large file over every line at once
 * would cost each line the whole file.
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
  return { packages: q.data ?? [], loaded: q.isFetched, from: substrate.quickestLine() };
}
