import { beforeEach, describe, expect, it } from "vitest";
import { taskMatchesJob } from "@/hooks/usePrintHistory";
import { formatRemaining } from "@/lib/format";
import { BambuCloudClient } from "@/server/bambu-cloud";
import { clearCoverCache, fetchCover, listPublicTasks } from "@/server/print-history";
import { fakeFetch, jsonResponse } from "../support/fake-fetch";

const SERIAL = "01P00A000000001";
const TASKS = {
  hits: [
    {
      id: 111,
      title: "Cardboard Spool",
      designTitle: "FilaClip – The Only Filament Clip You Need",
      cover: "https://cdn.example/cover-111.png?sig=abc",
      status: 2,
      plateIndex: 1,
      startTime: "2026-11-01T10:00:00Z",
      endTime: "2026-11-01T11:00:00Z",
      weight: 12.4,
      costTime: 3600,
      deviceId: SERIAL,
    },
    { id: 222, title: "Other printer", cover: "https://cdn.example/x.png", deviceId: "OTHER" },
    { id: 333, title: "No cover", cover: "", deviceId: SERIAL },
  ],
};

function client(extra: Record<string, () => Response> = {}) {
  const f = fakeFetch({
    [`GET /v1/user-service/my/tasks?deviceId=${SERIAL}&limit=10`]: () => jsonResponse(TASKS),
    [`GET /v1/user-service/my/tasks?deviceId=${SERIAL}&limit=20`]: () => jsonResponse(TASKS),
    "GET /cover-111.png?sig=abc": () =>
      new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }),
    ...extra,
  });
  return {
    f,
    ctx: { client: new BambuCloudClient("global", f.fetch), token: "tok", serial: SERIAL },
  };
}

describe("print history", () => {
  beforeEach(() => clearCoverCache());

  it("lists this printer's tasks with same-origin cover URLs only", async () => {
    const { f, ctx } = client();
    const tasks = await listPublicTasks(ctx, 10);
    expect(f.calls[0]!.headers.authorization).toBe("Bearer tok");
    expect(tasks.map((t) => t.id)).toEqual(["111", "333"]);
    expect(tasks[0]).toMatchObject({
      title: "Cardboard Spool",
      designTitle: "FilaClip – The Only Filament Clip You Need",
      cover: "/api/bambu/cover?id=111",
      status: "finished",
      weightGrams: 12.4,
      costTimeSeconds: 3600,
    });
    expect(tasks[1]!.cover).toBeNull();
    expect(tasks[1]!.designTitle).toBeNull();
    // The signed CDN URL never reaches the browser.
    expect(JSON.stringify(tasks)).not.toContain("cdn.example");
  });

  it("proxies and caches a cover image", async () => {
    const { f, ctx } = client();
    const img = await fetchCover(ctx, "111");
    expect(img.contentType).toBe("image/png");
    expect(new Uint8Array(img.body)).toEqual(new Uint8Array([137, 80, 78, 71]));
    await fetchCover(ctx, "111");
    expect(f.calls).toHaveLength(2); // task lookup + image, second call served from cache
  });

  it("refuses covers of tasks that are not on this printer", async () => {
    const { ctx } = client();
    await expect(fetchCover(ctx, "222")).rejects.toMatchObject({ status: 404 });
    await expect(fetchCover(ctx, "333")).rejects.toMatchObject({ status: 404 });
  });

  it("maps an expired token to a sign-in message", async () => {
    const { ctx } = client({
      [`GET /v1/user-service/my/tasks?deviceId=${SERIAL}&limit=10`]: () => jsonResponse({}, 401),
    });
    await expect(listPublicTasks(ctx, 10)).rejects.toMatchObject({
      status: 401,
      message: "Bambu session expired — sign in again",
    });
  });
});

describe("taskMatchesJob", () => {
  const start = Date.parse("2026-11-01T10:00:00Z");
  it("accepts the task of the running job and rejects an older print", () => {
    expect(taskMatchesJob({ startTime: "2026-11-01T10:02:00Z" }, { startedAt: start })).toBe(true);
    expect(taskMatchesJob({ startTime: "2026-10-30T08:00:00Z" }, { startedAt: start })).toBe(false);
  });
  it("trusts the newest task when either side has no start time", () => {
    expect(taskMatchesJob({ startTime: null }, { startedAt: start })).toBe(true);
    expect(taskMatchesJob({ startTime: "2026-10-30T08:00:00Z" }, { startedAt: null })).toBe(true);
  });
});

describe("formatRemaining", () => {
  it("reads like Bambu Handy", () => {
    expect(formatRemaining(15 * 60)).toBe("About 15min left");
    expect(formatRemaining(65 * 60)).toBe("About 1h 05min left");
    expect(formatRemaining(20)).toBe("Less than 1min left");
    expect(formatRemaining(null)).toBe("--");
  });
});
