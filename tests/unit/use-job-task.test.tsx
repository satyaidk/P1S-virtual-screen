// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPrintHistoryCache,
  COVER_RETRIES,
  COVER_RETRY_MS,
  useJobTask,
} from "@/hooks/usePrintHistory";
import type { PublicTask } from "@/printer/history";

const task = (cover: string | null): PublicTask => ({
  id: "1",
  title: "Cardboard Spool",
  designTitle: "FilaClip",
  cover,
  status: "printing",
  plateIndex: 1,
  startTime: null,
  endTime: null,
  weightGrams: null,
  costTimeSeconds: null,
});

const job = { live: true, name: "FilaClip", startedAt: null };

function mockTasks(responses: PublicTask[][]) {
  const fetchMock = vi.fn(async () => {
    const tasks = responses.shift() ?? [];
    return new Response(JSON.stringify({ tasks }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Let pending promises (fetch → json → setState) settle. */
const flush = () => act(async () => {});

describe("useJobTask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPrintHistoryCache();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("re-checks Bambu Cloud until a just-started print gets its cover", async () => {
    // Regression: the cover arrived after the first lookup and was never fetched again.
    const fetchMock = mockTasks([[task(null)], [task(null)], [task("/api/bambu/cover?id=1")]]);
    const { result } = renderHook(() => useJobTask(job));
    await flush();
    expect(result.current?.cover).toBeNull();

    await act(async () => vi.advanceTimersByTime(COVER_RETRY_MS));
    await flush();
    expect(result.current?.cover).toBeNull();

    await act(async () => vi.advanceTimersByTime(COVER_RETRY_MS));
    await flush();
    expect(result.current?.cover).toBe("/api/bambu/cover?id=1");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Once found, it stops asking.
    await act(async () => vi.advanceTimersByTime(COVER_RETRY_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after a bounded number of attempts", async () => {
    const fetchMock = mockTasks([]);
    renderHook(() => useJobTask(job));
    for (let i = 0; i < COVER_RETRIES + 3; i++) {
      await flush();
      await act(async () => vi.advanceTimersByTime(COVER_RETRY_MS));
    }
    expect(fetchMock).toHaveBeenCalledTimes(COVER_RETRIES + 1);
  });

  it("does not call the cloud in demo mode", async () => {
    const fetchMock = mockTasks([]);
    const { result } = renderHook(() => useJobTask({ ...job, live: false }));
    await flush();
    expect(result.current?.id).toBe("demo");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
