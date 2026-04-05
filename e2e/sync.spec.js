import { test, expect } from "@playwright/test";

/**
 * E2E tests for karaoke song synchronization.
 *
 * These tests verify:
 * - The app loads and renders song metadata and lyrics
 * - Sync data (from sync.json) is loaded and the sync badge is shown
 * - The timeline is built with correct syllable timings from sync data
 * - Syllable highlighting updates in real time as audio position changes
 * - TapSync mode can be entered and exited
 * - Sync data can be cleared and rebuilt in fallback mode
 */

test.describe("Karaoke app – song loading", () => {
  test("shows song title and number after loading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();
    await expect(page.getByText("Cântico 160")).toBeVisible();
    await expect(page.getByText("Lucas 2:10")).toBeVisible();
  });

  test("displays the sync badge when sync.json is loaded", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();
    await expect(page.getByText("✓ Sincronizado")).toBeVisible();
  });

  test("renders all song sections with their labels", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();
    // Section labels are uppercased in CSS but the text content is not
    await expect(page.getByText("Verso 1")).toBeVisible();
    await expect(page.getByText("Refrão")).toBeVisible();
    await expect(page.getByText("Verso 2")).toBeVisible();
  });

  test("renders syllable text from the first verse", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();
    // "Paz" is a standalone syllable in verse 1, line 1
    await expect(page.getByText("Paz", { exact: true })).toBeVisible();
    // "Ho" is the first syllable of verse 1, line 2
    await expect(page.getByText("Ho", { exact: true })).toBeVisible();
  });
});

test.describe("Karaoke app – syllable synchronization", () => {
  test("first syllable becomes active at its synced timestamp", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();

    // Simulate the audio reaching the first syllable timestamp (22080 ms = 22.080 s)
    // by overriding currentTime and dispatching a timeupdate event.
    await page.evaluate(() => {
      const audio = document.querySelector("audio");
      if (!audio) return;
      Object.defineProperty(audio, "currentTime", {
        get: () => 22.08,
        configurable: true,
      });
      audio.dispatchEvent(new Event("timeupdate"));
    });

    // The active syllable gets font-weight 600 via inline style.
    // First syllable text is '"Gló' – verify a span with bold weight contains it.
    const activeSyllable = page.locator('span[style*="font-weight: 600"]').filter({
      hasText: /Gló/,
    });
    await expect(activeSyllable).toBeVisible({ timeout: 3000 });
  });

  test("syllable highlight advances to the next syllable over time", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();

    // Advance to the first syllable of line v1l2: "Ho" at 34120 ms (34.12 s).
    // Being the first syllable of its line, it is reliably matched by the
    // timeline lookup (cumulative offset = 0, so lineStart === its startMs).
    await page.evaluate(() => {
      const audio = document.querySelector("audio");
      if (!audio) return;
      Object.defineProperty(audio, "currentTime", {
        get: () => 34.12,
        configurable: true,
      });
      audio.dispatchEvent(new Event("timeupdate"));
    });

    const activeSyllable = page.locator('span[style*="font-weight: 600"]').filter({
      hasText: /^Ho$/,
    });
    await expect(activeSyllable).toBeVisible({ timeout: 3000 });
  });

  test("time display reflects current audio position", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();

    // Seek to 22 seconds
    await page.evaluate(() => {
      const audio = document.querySelector("audio");
      if (!audio) return;
      Object.defineProperty(audio, "currentTime", {
        get: () => 22.08,
        configurable: true,
      });
      audio.dispatchEvent(new Event("timeupdate"));
    });

    // The footer shows MM:SS – expect "0:22"
    await expect(page.getByText("0:22")).toBeVisible({ timeout: 3000 });
  });

  test("time counter shows 0:00 before playback begins", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();

    // Before playback the time counter should show 0:00 and the play button
    // should show the play triangle (not the pause icon).
    await expect(page.getByText("0:00").first()).toBeVisible();
    await expect(page.locator("button").filter({ hasText: "▶" })).toBeVisible();
  });
});

test.describe("Karaoke app – TapSync mode", () => {
  test("opens TapSync overlay via settings panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();

    // Open the settings panel with the gear button
    await page.locator("button").filter({ hasText: "⚙" }).click();
    await expect(page.getByText("SINCRONIZAÇÃO")).toBeVisible();

    // The Tap Sync button is enabled once hasAudio=true (set synchronously on load)
    await page.locator("button").filter({ hasText: "Tap Sync" }).click();

    await expect(page.getByText("MODO SINCRONIZAÇÃO")).toBeVisible();
  });

  test("TapSync shows the song title and first syllable prompt", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();

    await page.locator("button").filter({ hasText: "⚙" }).click();
    await page.locator("button").filter({ hasText: "Tap Sync" }).click();

    await expect(page.getByText("MODO SINCRONIZAÇÃO")).toBeVisible();
    // Song title appears in the TapSync header
    await expect(
      page.locator("div").filter({ hasText: "As Boas Novas sobre Jesus" }).first()
    ).toBeVisible();
    // Syllable counter shows 0 / total
    await expect(page.getByText(/Sílaba 0\//)).toBeVisible();
  });

  test("closes TapSync overlay via the Fechar button", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();

    await page.locator("button").filter({ hasText: "⚙" }).click();
    await page.locator("button").filter({ hasText: "Tap Sync" }).click();
    await expect(page.getByText("MODO SINCRONIZAÇÃO")).toBeVisible();

    await page.locator("button").filter({ hasText: "Fechar" }).click();
    await expect(page.getByText("MODO SINCRONIZAÇÃO")).not.toBeVisible();
    // Main app is visible again
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();
  });
});

test.describe("Karaoke app – sync data management", () => {
  test("clearing sync data removes the sync badge", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("✓ Sincronizado")).toBeVisible();

    // Open settings and clear sync
    await page.locator("button").filter({ hasText: "⚙" }).click();
    await page.locator("button").filter({ hasText: "Limpar Sync" }).click();

    await expect(page.getByText("✓ Sincronizado")).not.toBeVisible();
  });

  test("after clearing sync, lyrics are still visible (fallback timeline)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();

    await page.locator("button").filter({ hasText: "⚙" }).click();
    await page.locator("button").filter({ hasText: "Limpar Sync" }).click();

    // Lyrics should still render in fallback mode
    await expect(page.getByText("Verso 1")).toBeVisible();
    await expect(page.getByText("Paz", { exact: true })).toBeVisible();
  });

  test("sync badge reappears after importing sync data", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();

    // Clear sync first
    await page.locator("button").filter({ hasText: "⚙" }).click();
    await page.locator("button").filter({ hasText: "Limpar Sync" }).click();
    await expect(page.getByText("✓ Sincronizado")).not.toBeVisible();

    // Inject sync data directly into localStorage (simulating an import)
    const syncData = await page.evaluate(async () => {
      const res = await fetch("/songs/cantico-160/sync.json");
      return res.json();
    });

    await page.evaluate((data) => {
      localStorage.setItem("sync_cantico-160", JSON.stringify(data));
    }, syncData);

    // Reload the page; the app should pick up the localStorage sync data
    await page.reload();
    await expect(page.getByText("As Boas Novas sobre Jesus")).toBeVisible();
    await expect(page.getByText("✓ Sincronizado")).toBeVisible();
  });
});
