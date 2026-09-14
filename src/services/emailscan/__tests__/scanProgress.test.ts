import {
  getScanProgress,
  scanProgressFinish,
  scanProgressLegDone,
  scanProgressLegError,
  scanProgressLegStart,
  scanProgressStaged,
  scanProgressStart,
  subscribeScanProgress,
} from "../scanProgress";

describe("scanProgress store (Phase I / J3-I1)", () => {
  it("starts active with the leg total and resets prior state", () => {
    scanProgressLegError("stale"); // dirty the store first
    scanProgressStart(4);
    const s = getScanProgress();
    expect(s).toMatchObject({
      active: true,
      legTotal: 4,
      legIndex: -1,
      legsDone: 0,
      errors: [],
      staged: 0,
    });
  });

  it("tracks leg start, staged chunks, and leg completion", () => {
    scanProgressStart(2);
    scanProgressLegStart(0, "proton:x@y.me");
    expect(getScanProgress()).toMatchObject({
      legIndex: 0,
      mailboxId: "proton:x@y.me",
      staged: 0,
    });
    scanProgressStaged(75);
    scanProgressStaged(149);
    expect(getScanProgress().staged).toBe(149);
    scanProgressLegDone();
    const s = getScanProgress();
    expect(s.legsDone).toBe(1);
    expect(s.staged).toBe(0);
    expect(s.mailboxId).toBeNull();
  });

  it("counts a failed leg as done and records its error", () => {
    scanProgressStart(3);
    scanProgressLegStart(1, "outlook:x");
    scanProgressLegError("outlook:x: token expired");
    const s = getScanProgress();
    expect(s.legsDone).toBe(1);
    expect(s.errors).toEqual(["outlook:x: token expired"]);
  });

  it("finish deactivates and carries the summary", () => {
    scanProgressStart(2);
    scanProgressLegStart(0, "m");
    scanProgressFinish(5, ["m: boom"]);
    const s = getScanProgress();
    expect(s).toMatchObject({
      active: false,
      imported: 5,
      errors: ["m: boom"],
      mailboxId: null,
    });
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    let calls = 0;
    const off = subscribeScanProgress(() => {
      calls += 1;
    });
    scanProgressStart(1);
    expect(calls).toBe(1);
    off();
    scanProgressFinish(0, []);
    expect(calls).toBe(1);
  });

  it("a throwing listener is logged and never breaks a set()", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const off = subscribeScanProgress(() => {
      throw new Error("listener boom");
    });
    try {
      scanProgressStart(2);
      expect(getScanProgress().active).toBe(true);
      expect(
        logSpy.mock.calls.some((call) =>
          String(call[0]).includes("scanProgress listener FAILED"),
        ),
      ).toBe(true);
    } finally {
      off();
      logSpy.mockRestore();
    }
  });
});
