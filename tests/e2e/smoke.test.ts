import { test, expect } from "../support/fixtures";

test.describe("Smoke Tests", () => {
  test("[P0] app loads successfully", async ({ page }) => {
    // Given: the app is running
    await page.goto("/");

    // When: the page finishes loading
    await page.waitForLoadState("domcontentloaded");

    // Then: the page title should be present
    await expect(page).toHaveTitle(/whisper/i);
  });
});
