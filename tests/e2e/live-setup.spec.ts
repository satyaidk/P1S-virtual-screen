import { expect, test } from "@playwright/test";

/**
 * Live mode without a configured printer. Real Bambu accounts are never contacted here: these
 * tests only cover the setup UI, the server routes' input validation and request guards.
 */

test("defaults to the real printer and explains that setup is needed", async ({ page }) => {
  await page.goto("/");
  const display = page.getByTestId("virtual-display");
  await expect(display).toBeVisible();
  await expect(page.getByTestId("printer-setup")).toBeVisible();
  await expect(page.getByTestId("simulation-controls")).toHaveCount(0);
  await expect(display.getByText("SIM", { exact: true })).toHaveCount(0);
  await expect(display.getByTestId("offline-panel")).toContainText("Not connected yet");
  await expect(page.getByTestId("current-connection")).toContainText("No printer connected yet");
  // The serial is built in and the IP is discovered: only the access code is asked for.
  const card = page.getByTestId("my-printer");
  await expect(card).toContainText("SN •••••••••••3044");
  await expect(page.getByTestId("discovery-status")).toBeVisible();
  await expect(page.getByTestId("access-code")).toBeVisible();
  await expect(page.getByTestId("connect-access-code")).toBeDisabled();
  await expect(page.getByTestId("sign-in")).toHaveCount(0); // cloud sign-in is optional, collapsed
});

test("display controls are disabled until a printer is connected", async ({ page }) => {
  await page.goto("/display?scale=1");
  const display = page.getByTestId("virtual-display");
  await display.getByTestId("tab-control").click();
  await expect(display.getByTestId("pause")).toBeDisabled();
  await expect(display.getByTestId("stop")).toBeDisabled();
});

test("setup routes validate input and reject cross-origin requests", async ({
  request,
  baseURL,
}) => {
  const status = await request.get("/api/bambu/status");
  expect(status.ok()).toBe(true);
  expect(await status.json()).toMatchObject({ cloud: { signedIn: false }, printer: null });

  const badEmail = await request.post("/api/bambu/email-code", {
    data: { region: "global", account: "not-an-email" },
  });
  expect(badEmail.status()).toBe(400);

  const devices = await request.get("/api/bambu/devices");
  expect(devices.status()).toBe(401);

  const foreign = await request.post("/api/bambu/logout", {
    headers: { origin: "https://evil.example" },
    data: {},
  });
  expect(foreign.status()).toBe(403);

  const shortCode = await request.post("/api/bambu/connect", {
    data: { source: "access-code", accessCode: "12" },
  });
  expect(shortCode.status()).toBe(400);
  expect((await shortCode.json()).error).toMatch(/Access Code|8 characters/);

  const status2 = await request.get("/api/bambu/status");
  expect((await status2.json()).myPrinter).toMatchObject({
    maskedSerial: "•••••••••••3044",
    model: "P1S",
  });
  expect(JSON.stringify(await (await request.get("/api/bambu/status")).json())).not.toContain(
    "01P00C662003044",
  );

  const badLan = await request.post("/api/bambu/connect", {
    headers: { origin: baseURL! },
    data: {
      source: "manual",
      host: "192.168.1.5; rm -rf",
      serial: "01P00C662003044",
      accessCode: "abcd1234",
    },
  });
  expect(badLan.status()).toBe(400);

  const cmd = await request.post("/api/bridge/command", {
    data: { type: "command", requestId: "r1", command: { type: "pause" } },
  });
  expect(await cmd.json()).toMatchObject({ type: "command_result", requestId: "r1", ok: false });
});

test("bridge stream announces that nothing is configured", async ({ page }) => {
  await page.goto("/");
  const first = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const es = new EventSource("/api/bridge/stream");
        es.onmessage = (e) => {
          es.close();
          resolve(e.data as string);
        };
      }),
  );
  expect(JSON.parse(first)).toMatchObject({
    type: "hello",
    printer: null,
    mode: null,
    commands: [],
  });
});
