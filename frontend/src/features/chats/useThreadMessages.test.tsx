// Does scrolling to the top actually ask for older messages?
//
// Reported twice as still broken after being fixed once, and reading the code did not explain it —
// the scroll container has the handler, the cursor bookkeeping looks right, and the backend's
// pagination is right. So this drives the hook for real: a thread with more than one page, a
// scroll event at the top, and an assertion about the request that should follow.
//
// The point is to make the answer observable instead of arguable. Either the second request is
// never made (the frontend), or it is made and comes back wrong (the backend).

// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/api";
import { useThreadMessages } from "@/features/chats/useThreadMessages";

const listMessages = vi.fn();

vi.mock("@/lib/mtApi", () => ({
  mtCall: <T,>(p: Promise<T>) => p,
  chatApi: () => ({ listMessages }),
}));

// The outbox owns delivery and is not what is under test here.
vi.mock("@/hooks/useOutbox", () => ({
  useOutbox: () => ({
    reconcile: () => {},
    enqueue: () => {},
    retry: () => {},
    discard: () => {},
    pending: [],
  }),
}));

// The updates socket only triggers refetches; a test of pagination should not need one.
vi.mock("@/hooks/useUpdates", () => ({ useUpdatesTopic: () => {} }));

vi.mock("@/lib/cache", () => ({
  getCache: () => undefined,
  setCache: () => {},
}));

function messages(from: number, to: number): Message[] {
  const out: Message[] = [];
  for (let id = from; id <= to; id++) {
    out.push({
      id,
      threadId: 7,
      senderId: 1,
      content: `m${id}`,
      createdAt: "2026-08-20T00:00:00Z",
    } as Message);
  }
  return out;
}

/** Renders the hook and gives the test the scrolling element it hands back. */
function mount() {
  const seen: { current: ReturnType<typeof useThreadMessages> | null } = {
    current: null,
  };
  function Probe() {
    const chat = useThreadMessages(7);
    seen.current = chat;
    return <div ref={chat.listRef} onScroll={chat.onScroll} />;
  }
  const view = render(<Probe />);
  return { seen, view };
}

describe("scrolling to the top", () => {
  beforeEach(() => {
    listMessages.mockReset();
  });

  it("asks for the page before the one it holds", async () => {
    // The newest page, with more behind it — exactly what the server returns for a long thread.
    listMessages.mockResolvedValueOnce({
      messages: messages(101, 200),
      page: { pageStart: 200, pageSize: 100, hasMore: true, nextStart: 100 },
    });
    listMessages.mockResolvedValueOnce({
      messages: messages(1, 100),
      page: { pageStart: 100, pageSize: 100, hasMore: false, nextStart: null },
    });

    const { seen } = mount();
    await waitFor(() => expect(seen.current?.messages.length).toBe(100));

    const el = seen.current!.listRef.current!;
    // A container scrolled to the very top.
    Object.defineProperty(el, "scrollTop", { value: 0, writable: true });
    Object.defineProperty(el, "scrollHeight", { value: 5000, writable: true });
    Object.defineProperty(el, "clientHeight", { value: 500, writable: true });

    await act(async () => {
      seen.current!.onScroll();
    });

    await waitFor(() => expect(listMessages).toHaveBeenCalledTimes(2));
    expect(listMessages.mock.calls[1][0]).toMatchObject({ pageStart: 100 });
    await waitFor(() => expect(seen.current!.messages.length).toBe(200));
  });

  it("does not ask again when the server said there is nothing older", async () => {
    listMessages.mockResolvedValue({
      messages: messages(1, 20),
      page: { pageStart: 20, pageSize: 20, hasMore: false, nextStart: null },
    });

    const { seen } = mount();
    await waitFor(() => expect(seen.current?.messages.length).toBe(20));

    const el = seen.current!.listRef.current!;
    Object.defineProperty(el, "scrollTop", { value: 0, writable: true });
    Object.defineProperty(el, "scrollHeight", { value: 500, writable: true });
    Object.defineProperty(el, "clientHeight", { value: 500, writable: true });

    await act(async () => {
      seen.current!.onScroll();
    });

    expect(listMessages).toHaveBeenCalledTimes(1);
  });
});
