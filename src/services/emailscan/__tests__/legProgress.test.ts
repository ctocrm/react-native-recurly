import {
  createLegProgressLogger,
  formatLegDone,
  formatLegProgress,
  shouldLogProgress,
} from "../legProgress";

describe("legProgress (R13 / Phase H)", () => {
  it("first tick always logs", () => {
    expect(shouldLogProgress(null, 1_000)).toBe(true);
  });

  it("logs again only after the full interval", () => {
    expect(shouldLogProgress(0, 29_999)).toBe(false);
    expect(shouldLogProgress(0, 30_000)).toBe(true);
  });

  it("honors a custom interval", () => {
    expect(shouldLogProgress(0, 4_999, 5_000)).toBe(false);
    expect(shouldLogProgress(0, 5_000, 5_000)).toBe(true);
  });

  it("formats stable greppable lines", () => {
    expect(formatLegProgress("proton:x@y.me", 75)).toBe(
      "[MailScan] proton:x@y.me progress: 75 staged",
    );
    expect(formatLegDone("proton:x@y.me", 475, 12)).toBe(
      "[MailScan] proton:x@y.me leg done: 475 staged, 12 candidate(s)",
    );
  });

  it("pacer emits one line per interval window and one terminal line", () => {
    const lines: string[] = [];
    let clock = 0;
    const pacer = createLegProgressLogger("tuta:a@b.io", {
      intervalMs: 30_000,
      now: () => clock,
      log: (l: string) => lines.push(l),
    });
    pacer.tick(10); // t=0 → logs
    clock = 10_000;
    pacer.tick(20); // inside window → silent
    clock = 31_000;
    pacer.tick(30); // past window → logs
    pacer.done(30, 3);
    expect(lines).toEqual([
      "[MailScan] tuta:a@b.io progress: 10 staged",
      "[MailScan] tuta:a@b.io progress: 30 staged",
      "[MailScan] tuta:a@b.io leg done: 30 staged, 3 candidate(s)",
    ]);
  });

  it("done() is terminal — later ticks are ignored", () => {
    const lines: string[] = [];
    const pacer = createLegProgressLogger("m", {
      now: () => 100_000,
      log: (l: string) => lines.push(l),
    });
    pacer.done(5, 1);
    pacer.tick(99);
    expect(lines).toEqual(["[MailScan] m leg done: 5 staged, 1 candidate(s)"]);
  });
});
