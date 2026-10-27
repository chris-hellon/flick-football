import { describe, expect, it } from "vitest";
import { GW, H, W } from "../../src/client/src/render/pitch";

describe("pitch dimensions", () => {
  it("matches the prototype's world units", () => {
    expect(W).toBe(680);
    expect(H).toBe(1050);
    expect(GW).toBe(150);
  });
});
