import { describe, expect, it } from "vitest";
import { formatDuration, maskSerial, prettyJobName, truncateMiddle, wifiBars } from "@/lib/format";
import { changedPaths, deepFreeze, replaceEqualDeep } from "@/lib/structural-sharing";
import { EventLog } from "@/printer/event-log";

describe("structural sharing", () => {
  it("reuses equal sub-trees", () => {
    const prev = { a: { x: 1 }, b: [{ y: 2 }], c: 3 };
    const next = { a: { x: 1 }, b: [{ y: 2 }], c: 4 };
    const out = replaceEqualDeep(prev, next);
    expect(out).not.toBe(prev);
    expect(out.a).toBe(prev.a);
    expect(out.b).toBe(prev.b);
    expect(out.c).toBe(4);
    expect(replaceEqualDeep(prev, structuredClone(prev))).toBe(prev);
  });

  it("lists changed paths and freezes deeply", () => {
    expect(changedPaths({ a: { b: 1, c: 2 } }, { a: { b: 1, c: 3 } })).toEqual(["a.c"]);
    const frozen = deepFreeze({ a: { b: 1 } });
    expect(Object.isFrozen(frozen.a)).toBe(true);
  });
});

describe("format", () => {
  it("formats durations", () => {
    expect(formatDuration(null)).toBe("--");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(125)).toBe("2m 05s");
    expect(formatDuration(3 * 3600 + 7 * 60)).toBe("3h 07m");
  });

  it("masks serial numbers", () => {
    expect(maskSerial("01P00A000000123")).toBe("•••••••••••0123");
    expect(maskSerial(null)).toBe("Not reported");
  });

  it("truncates and prettifies names", () => {
    expect(truncateMiddle("abcdefghijklmnopqrstuvwxyz", 10)).toHaveLength(10);
    expect(prettyJobName("Cable_Clip_x8.3mf")).toBe("Cable Clip x8");
    expect(wifiBars(-50)).toBe(3);
    expect(wifiBars(null)).toBeNull();
  });
});

describe("EventLog", () => {
  it("is bounded", () => {
    const log = new EventLog(() => 0, 3);
    for (let i = 0; i < 5; i++) log.push({ category: "state", level: "info", message: `m${i}` });
    expect(log.entries().map((e) => e.message)).toEqual(["m2", "m3", "m4"]);
  });
});
