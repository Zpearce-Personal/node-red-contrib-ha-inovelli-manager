const assert = require("assert");
const {
  snapToMatterColor,
  snapToMatterBrightness,
  durationToMs,
  hueToRgb,
} = require("../nodes/lib/convert");

describe("snapToMatterColor", function () {
  it("snaps to the nearest named color by hue", function () {
    assert.strictEqual(snapToMatterColor("red"), "Red");
    assert.strictEqual(snapToMatterColor("#0000ff"), "Blue");
    assert.strictEqual(snapToMatterColor(35), "Orange");
    assert.strictEqual(snapToMatterColor([255, 255, 255]), "White");
    assert.strictEqual(snapToMatterColor(361), "White");
  });
});

describe("snapToMatterBrightness", function () {
  it("snaps to supported steps", function () {
    assert.strictEqual(snapToMatterBrightness(100), 100);
    assert.strictEqual(snapToMatterBrightness(2), 1);
    assert.strictEqual(snapToMatterBrightness(2.1), 3);
    assert.strictEqual(snapToMatterBrightness(64), 60);
    assert.strictEqual(snapToMatterBrightness(66), 70);
  });
});

describe("durationToMs", function () {
  it("converts finite bytes and nulls infinite/off", function () {
    assert.strictEqual(durationToMs(10), 10000);
    assert.strictEqual(durationToMs(61), 60000);
    assert.strictEqual(durationToMs(121), 3600000);
    assert.strictEqual(durationToMs(255), null);
    assert.strictEqual(durationToMs(0), null);
  });
});

describe("hueToRgb", function () {
  it("round-trips device hue bytes", function () {
    assert.deepStrictEqual(hueToRgb(255), [255, 255, 255]);
    assert.deepStrictEqual(hueToRgb(0), [255, 0, 0]);
    assert.deepStrictEqual(hueToRgb(169), [0, 2, 255]); // 169*360/254 ≈ 239.5°
  });
});
