/*
 * The developer line panel, behind a route nothing links to.
 *
 * Everything MultiPath does is invisible when it works, which is exactly what makes it hard to
 * trust: there is nothing to see when it is fine and nothing to see when it is not. This page is
 * the answer to "how would you know?" — it puts what each line *is* (rank, state, measured latency)
 * next to what actually *happened* (which line served the last requests). Those two disagree more
 * often than you would expect, and the disagreement is usually where the bug is.
 */

import { useEffect, useRef } from "react";
import { mountLinePanel } from "@micro-teams/multipath";

import { lineManager } from "@/lib/lines";

export default function LinesPage() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    return mountLinePanel(lineManager, host.current);
  }, []);

  return <div ref={host} />;
}
