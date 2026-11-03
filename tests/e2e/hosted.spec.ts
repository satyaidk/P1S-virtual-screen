import { expect, test } from "@playwright/test";

/**
 * Hosted (Vercel-like) mode: no LAN, no disk. Bambu accounts are never contacted; this covers the
 * UI and route behaviour that do not need a real sign-in.
 */

test("shows Bambu sign-in instead of the access-code card", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hosted-notice")).toContainText("view-only");
  await expect(page.getByTestId("remote-control-hint").getByRole("link")).toHaveAttribute(
    "href",
    /docs\/remote-access\.md$/,
  );
  await expect(page.getByTestId("hosted-sign-in")).toBeVisible();
  await expect(page.getByTestId("sign-in")).toBeVisible();
  await expect(page.getByTestId("my-printer")).toHaveCount(0);
  await expect(page.getByTestId("access-code")).toHaveCount(0);
  await expect(page.getByTestId("virtual-display").getByTestId("offline-panel")).toContainText(
    "sign in with your Bambu account",
  );
});

test("hosted routes refuse LAN mode and require sign-in", async ({ request }) => {
  const status = await (await request.get("/api/bambu/status")).json();
  expect(status).toMatchObject({ hosted: true, setupError: null, cloud: { signedIn: false } });

  const lan = await request.post("/api/bambu/connect", {
    data: { source: "access-code", accessCode: "12345678" },
  });
  expect(lan.status()).toBe(400);
  expect((await lan.json()).error).toMatch(/only works when this app runs on a computer/);

  expect((await request.get("/api/bambu/devices")).status()).toBe(401);

  const cmd = await request.post("/api/bridge/command", {
    data: { type: "command", requestId: "r1", command: { type: "pause" } },
  });
  expect(await cmd.json()).toMatchObject({
    ok: false,
    message: expect.stringMatching(/Read-only/),
  });
});
