// pi + OMP extension contract tests: mock ExtensionAPI, scripted streaming turns.
// The two files share one API surface, so the same scenario runs against both.
import { describe, test, expect } from "bun:test";
import { driveToksecExtension } from "./helpers.mjs";

const targets = [
  ["pi", new URL("../pi/toksec.ts", import.meta.url).pathname],
  ["omp", new URL("../omp/toksec.ts", import.meta.url).pathname],
];

for (const [name, extPath] of targets) {
  describe(`${name} toksec extension`, () => {
    test("clears status on session_start", async () => {
      const t = await driveToksecExtension(extPath);
      await t.emit("session_start", { reason: "startup" });
      expect(t.lastStatus()).toBeUndefined();
    });

    test("tracks provider usage into an EMA rate and settles at message_end", async () => {
      const t = await driveToksecExtension(extPath);

      await t.emit("message_update", { usage: { output: 0 } });
      expect(t.lastStatus()).toContain("tok/s");

      await Bun.sleep(600);
      await t.emit("message_update", { usage: { output: 600 } });
      let rate = t.rateOf(t.lastStatus());
      expect(rate).toBeGreaterThanOrEqual(600);
      expect(rate).toBeLessThanOrEqual(1600);

      await Bun.sleep(400);
      await t.emit("message_update", { usage: { output: 750 } });
      rate = t.rateOf(t.lastStatus());
      expect(rate).toBeGreaterThanOrEqual(400);
      expect(rate).toBeLessThanOrEqual(1000);

      await t.emit("message_end", { message: { usage: { output: 900 } } });
      expect(t.lastStatus()).toMatch(/tok\/s .* out/);
      expect(t.rateOf(t.lastStatus())).not.toBeNull();
    });

    test("falls back to a char estimate when usage is silent", async () => {
      const t = await driveToksecExtension(extPath);
      await t.emit("message_update", { assistantMessageEvent: { type: "text_delta", delta: "a".repeat(360) } });
      await Bun.sleep(500);
      await t.emit("message_update", { assistantMessageEvent: { type: "text_delta", delta: "b".repeat(2160) } });
      const rate = t.rateOf(t.lastStatus());
      // 2520 chars ≈ 700 tokens; 600 of them over ~0.5 s ⇒ ~1200 tok/s
      expect(rate).toBeGreaterThanOrEqual(600);
      expect(rate).toBeLessThanOrEqual(2000);
    });

    test("survives malformed events", async () => {
      const t = await driveToksecExtension(extPath);
      await t.emit("message_update", null);
      await t.emit("message_end", {});
      await t.emit("message_update", { assistantMessageEvent: { type: "text_delta" } });
      expect(t.lastStatus()).toContain("tok/s");
    });
  });
}