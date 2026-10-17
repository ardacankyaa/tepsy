import test from "node:test";
import assert from "node:assert/strict";
import soundEngine from "../src/lib/sound.mjs";

test("muted preference prevents AudioContext creation and sound playback", () => {
  const previous = globalThis.window;
  globalThis.window = {
    localStorage: { getItem: () => "false" },
    get AudioContext() {
      throw new Error("muted playback must not create an audio context");
    },
  };
  try {
    assert.equal(soundEngine.getContext(), null);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
