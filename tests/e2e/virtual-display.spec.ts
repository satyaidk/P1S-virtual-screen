import { expect, test, type Page } from "@playwright/test";

const display = (page: Page) => page.getByTestId("virtual-display");
const screen = (page: Page) => display(page).getByTestId("screen-content");

async function openConsole(page: Page, errors: string[] = []) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?demo=1");
  await expect(display(page)).toBeVisible();
  await page.getByTestId("zoom-1").click();
  await expect(page.getByTestId("console-connection-status")).toHaveText("connected");
}

async function readNumber(page: Page, testId: string): Promise<number> {
  const text = await display(page).getByTestId(testId).innerText();
  return Number(text.replace(/[^\d.]/g, ""));
}

async function startPrint(page: Page) {
  await page.getByTestId("sim-speed-120").click();
  await display(page).getByTestId("start-sample").click();
  await expect(display(page).getByTestId("status-label")).toHaveText(/Preparing|Printing/);
  await expect(display(page).getByTestId("status-label")).toHaveText("Printing", {
    timeout: 15_000,
  });
}

test("starts without printer credentials and without runtime errors", async ({ page }) => {
  const errors: string[] = [];
  await openConsole(page, errors);
  await expect(display(page).getByTestId("status-label")).toHaveText("Ready");
  await expect(display(page).getByText("SIM", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("virtual display is exactly 320x240 and the main screen does not scroll", async ({ page }) => {
  await openConsole(page);
  const box = await display(page).boundingBox();
  expect(box?.width).toBe(320);
  expect(box?.height).toBe(240);

  for (const scenario of ["standard", "mid-print", "sparse", "no-ams"]) {
    await page.getByTestId("scenario-select").selectOption(scenario);
    const overflow = await screen(page).evaluate((el) => {
      const inner = el.firstElementChild as HTMLElement;
      return { scroll: inner.scrollHeight, client: inner.clientHeight };
    });
    expect(overflow.scroll, scenario).toBeLessThanOrEqual(overflow.client);
  }
});

test("text stays readable at the logical resolution", async ({ page }) => {
  await openConsole(page);
  await page.getByTestId("scenario-select").selectOption("mid-print");
  for (const tab of ["home", "temperature", "ams", "control", "menu"]) {
    await display(page).getByTestId(`tab-${tab}`).click();
    const smallest = await display(page).evaluate((root) => {
      let min = Infinity;
      root.querySelectorAll("*").forEach((el) => {
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
        if (hasText) min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
      });
      return min;
    });
    expect(smallest, tab).toBeGreaterThanOrEqual(9);
  }
});

test("simulated print: starts, heats, progresses and completes", async ({ page }) => {
  await openConsole(page);
  await startPrint(page);
  const p1 = await readNumber(page, "job-progress");
  await expect
    .poll(() => readNumber(page, "job-progress"), { timeout: 10_000 })
    .toBeGreaterThan(p1);
  await display(page).getByTestId("tab-temperature").click();
  expect(await readNumber(page, "nozzle-current")).toBeGreaterThan(200);
  await page.getByTestId("sim-complete").click();
  await display(page).getByTestId("tab-home").click();
  await expect(display(page).getByTestId("status-label")).toHaveText("Finished");
  await expect(display(page).getByTestId("job-progress")).toHaveText("100%");
});

test("home shows the job preview image like Bambu Handy", async ({ page }) => {
  await openConsole(page);
  await expect(display(page).getByTestId("job-cover-placeholder")).toBeVisible();
  await page.getByTestId("scenario-select").selectOption("mid-print");
  const cover = display(page).getByTestId("job-cover").locator("img");
  await expect(cover).toBeVisible();
  // The image actually decoded (not a broken-image box).
  await expect
    .poll(() => cover.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(display(page).getByTestId("job-name")).toHaveText(/Cable Clip/);
  await expect(display(page).getByTestId("job-detail")).toHaveText(/Plate 1 · Layer \d+\/96/);
  await expect(display(page).getByTestId("job-remaining")).toHaveText(/^About \d+min left$/);
});

test("pause freezes progress and elapsed time; resume continues", async ({ page }) => {
  await openConsole(page);
  await page.getByTestId("scenario-select").selectOption("mid-print");
  await page.getByTestId("sim-speed-60").click();
  await display(page).getByTestId("tab-control").click();
  await display(page).getByTestId("pause").click();
  await expect(display(page).getByTestId("command-feedback")).toHaveAttribute(
    "data-status",
    "succeeded",
  );
  await display(page).getByTestId("tab-home").click();
  await expect(display(page).getByTestId("status-label")).toHaveText("Paused");
  const elapsed = await display(page).getByTestId("job-elapsed").innerText();
  const progress = await display(page).getByTestId("job-progress").innerText();
  await page.waitForTimeout(2000);
  await expect(display(page).getByTestId("job-elapsed")).toHaveText(elapsed);
  await expect(display(page).getByTestId("job-progress")).toHaveText(progress);

  await display(page).getByTestId("tab-control").click();
  await display(page).getByTestId("resume").click();
  await display(page).getByTestId("tab-home").click();
  await expect(display(page).getByTestId("status-label")).toHaveText("Printing");
  await expect(display(page).getByTestId("job-elapsed")).not.toHaveText(elapsed, { timeout: 5000 });
});

test("cancel requires explicit confirmation", async ({ page }) => {
  await openConsole(page);
  await page.getByTestId("scenario-select").selectOption("mid-print");
  await display(page).getByTestId("tab-control").click();
  await display(page).getByTestId("stop").click();
  await expect(display(page).getByRole("alertdialog")).toBeVisible();
  await display(page).getByTestId("confirm-cancel").click();
  await expect(display(page).getByRole("alertdialog")).toBeHidden();
  await expect(display(page).getByTestId("status-label")).toHaveText("Printing");

  await display(page).getByTestId("stop").click();
  await display(page).getByTestId("confirm-accept").click();
  await expect(display(page).getByTestId("status-label")).toHaveText("Cancelled");
  await expect(display(page).getByTestId("stop")).toBeDisabled();
});

test("AMS screen shows trays, active slot and unknown values honestly", async ({ page }) => {
  await openConsole(page);
  await display(page).getByTestId("tab-ams").click();
  await expect(display(page).getByTestId("tray-A1")).toContainText("IN USE");
  await expect(display(page).getByTestId("tray-A1-remain")).toHaveText("82%");
  await expect(display(page).getByTestId("tray-A3-remain")).toHaveText("? left");
  await expect(display(page).getByTestId("tray-A4")).toHaveAttribute("data-state", "empty");
  await display(page).getByTestId("tray-A2").click();
  await expect(display(page).getByTestId("tray-details")).toContainText("#F2F2EE");

  await page.getByTestId("scenario-select").selectOption("no-ams");
  await expect(display(page).getByTestId("no-ams")).toBeVisible();
});

test("missing telemetry is shown as unknown, not invented", async ({ page }) => {
  await openConsole(page);
  await page.getByTestId("scenario-select").selectOption("sparse");
  await display(page).getByTestId("tab-menu").click();
  await display(page).getByTestId("menu-info").click();
  await expect(display(page).getByTestId("info-firmware")).toHaveText("Not reported");
  await expect(display(page).getByTestId("info-serial")).toHaveText("Not reported");
  await expect(display(page).getByTestId("info-wi-fi")).toHaveText("Not reported");
  await display(page).getByTestId("tab-home").click();
  await startPrint(page);
  await expect(display(page).getByTestId("job-remaining")).toHaveText("--");
});

test("connection loss and reconnection update the interface", async ({ page }) => {
  await openConsole(page);
  await page.getByTestId("sim-wifi").click();
  await expect(display(page).getByTestId("offline-panel")).toContainText("Wi-Fi unavailable");
  await expect(display(page).getByTestId("status-label")).toHaveText("Offline");
  await display(page).getByTestId("tab-control").click();
  await expect(display(page).getByTestId("offline-banner")).toBeVisible();
  await page.getByTestId("sim-restore").click();
  await expect(display(page).getByTestId("status-label")).toHaveText("Ready", { timeout: 5000 });

  await page.getByTestId("sim-mqtt").click();
  await expect(display(page).getByTestId("status-label")).toHaveText("Offline");
  await page.getByTestId("sim-restore").click();
  await expect(display(page).getByTestId("status-label")).toHaveText("Ready", { timeout: 5000 });

  await page.getByTestId("log-tab-events").click();
  await expect(page.getByTestId("event-list")).toContainText(
    "connected → disconnected (Wi-Fi unavailable)",
  );
  await expect(page.getByTestId("event-list")).toContainText("connecting → connected");
});

test("stale telemetry is flagged and controls lock", async ({ page }) => {
  test.setTimeout(45_000);
  await openConsole(page);
  await page.getByTestId("scenario-select").selectOption("mid-print");
  await page.getByTestId("sim-freeze").click();
  await expect(display(page).getByTestId("stale-banner")).toBeVisible({ timeout: 25_000 });
  await expect(display(page).getByTestId("status-label")).toHaveText("No updates");
  await display(page).getByTestId("tab-control").click();
  await expect(display(page).getByTestId("pause")).toBeDisabled();
  await page.getByTestId("sim-freeze").click();
  await expect(display(page).getByTestId("pause")).toBeEnabled();
});

test("command failures and printer errors are reported", async ({ page }) => {
  await openConsole(page);
  await page.getByTestId("scenario-select").selectOption("mid-print");
  await page.getByTestId("fault-select").selectOption("reject_next_command");
  await page.getByTestId("sim-inject").click();
  await display(page).getByTestId("tab-control").click();
  await display(page).getByTestId("pause").click();
  await expect(display(page).getByTestId("command-feedback")).toHaveAttribute(
    "data-status",
    "failed",
  );

  await page.getByTestId("fault-select").selectOption("nozzle_heater_fault");
  await page.getByTestId("sim-inject").click();
  await display(page).getByTestId("tab-home").click();
  await expect(display(page).getByTestId("status-label")).toHaveText("Error");
  await display(page).getByTestId("alert-banner").click();
  await expect(display(page).getByTestId("notification-list")).toContainText(
    "Nozzle heater malfunction",
  );
  await expect(display(page).getByTestId("notification-list")).toContainText("Pause failed");
});

test("console and display share one state", async ({ page }) => {
  await openConsole(page);
  await display(page).getByTestId("tab-temperature").click();
  await display(page).getByTestId("bed-plus").click();
  await display(page).getByTestId("bed-plus").click();
  await expect(display(page).getByTestId("bed-target")).toHaveText("10°");
  await display(page).getByTestId("apply-temps").click();
  await expect(page.getByTestId("state-json")).toContainText(
    /"bed": \{\s+"current": [\d.]+,\s+"target": 10/,
  );
  await page.getByTestId("log-tab-commands").click();
  await expect(page.getByTestId("command-list")).toContainText("set_bed_target");
});

test("every navigation control works", async ({ page }) => {
  await openConsole(page);
  for (const tab of ["temperature", "ams", "control", "menu", "home"]) {
    await display(page).getByTestId(`tab-${tab}`).click();
    await expect(display(page)).toHaveAttribute("data-screen", tab);
  }
  for (const item of ["info", "settings", "notifications", "history"]) {
    await display(page).getByTestId("tab-menu").click();
    await display(page).getByTestId(`menu-${item}`).click();
    await expect(display(page)).toHaveAttribute("data-screen", item);
    await display(page).getByRole("button", { name: "Back" }).click();
    await expect(display(page)).toHaveAttribute("data-screen", "menu");
  }
  await display(page).getByTestId("tab-home").click();
  await display(page).getByTestId("tile-filament").click();
  await expect(display(page)).toHaveAttribute("data-screen", "ams");
  await display(page).getByTestId("tab-home").click();
  await display(page).getByTestId("tile-nozzle").click();
  await expect(display(page)).toHaveAttribute("data-screen", "temperature");
});

test("P2S-style fan control: draft, apply, and reported speed", async ({ page }) => {
  await openConsole(page);
  await page.getByTestId("scenario-select").selectOption("mid-print");
  await display(page).getByTestId("tab-control").click();
  await display(page).getByTestId("open-fans").click();
  await expect(display(page)).toHaveAttribute("data-screen", "fans");
  await expect(display(page).getByTestId("fan-part-value")).toHaveText("100%");

  await display(page).getByTestId("fan-part-minus").click();
  await display(page).getByTestId("fan-part-minus").click();
  await expect(display(page).getByTestId("fan-part-value")).toHaveText("80%");
  await display(page).getByTestId("fan-part-apply").click();
  await expect(display(page).getByTestId("fan-part-value")).toHaveText("80%");
  await expect(display(page).getByTestId("fan-part-apply")).toBeDisabled();

  await display(page).getByRole("button", { name: "Back" }).click();
  await expect(display(page)).toHaveAttribute("data-screen", "control");
  await expect(display(page).getByTestId("open-fans")).toHaveText("80%");
});

test("move screen locks axes while printing and unlocks when idle", async ({ page }) => {
  await openConsole(page);
  await page.getByTestId("scenario-select").selectOption("mid-print");
  await display(page).getByTestId("tab-control").click();
  await display(page).getByTestId("open-move").click();
  await expect(display(page)).toHaveAttribute("data-screen", "move");
  await expect(display(page).getByTestId("home-axes")).toBeDisabled();
  await expect(display(page).getByTestId("move-hint")).toHaveText("Axes are locked while printing");

  await page.getByTestId("scenario-select").selectOption("standard");
  await expect(display(page).getByTestId("home-axes")).toBeEnabled();
  // Cold nozzle: the extruder stays locked with an explanation.
  await expect(display(page).getByTestId("extrude")).toBeDisabled();
  await expect(display(page).getByTestId("move-hint")).toHaveText(/Heat the nozzle/);
  await display(page).getByTestId("step-1").click();
  await display(page).getByTestId("jog-xplus").click();
  await expect(display(page).getByTestId("command-feedback")).toBeVisible();
});

test("new sub-screens fit the 320x240 canvas", async ({ page }) => {
  await openConsole(page);
  await page.getByTestId("scenario-select").selectOption("mid-print");
  for (const [open, screenId] of [
    [["tab-control", "open-fans"], "fans"],
    [["tab-control", "open-move"], "move"],
    [["tab-menu", "menu-history"], "history"],
    [["tab-menu", "menu-info"], "info"],
  ] as const) {
    for (const id of open) await display(page).getByTestId(id).click();
    await expect(display(page)).toHaveAttribute("data-screen", screenId);
    const overflow = await screen(page).evaluate((el) => {
      const inner = el.firstElementChild as HTMLElement;
      return { scroll: inner.scrollHeight, client: inner.clientHeight };
    });
    expect(overflow.scroll, screenId).toBeLessThanOrEqual(overflow.client);
    if (screenId === "history")
      // Demo mode has no Bambu Cloud: history explains instead of failing.
      await expect(display(page).getByTestId("history-empty")).toContainText("Bambu Cloud");
  }
  // The build stamp tells which commit a deployment is running.
  await expect(display(page).getByTestId("info-app-build")).toHaveText(/^[0-9a-f]{7}|unknown$/);
  await expect(page.getByTestId("build-commit")).toHaveText(/^build /);
  const version = await (await page.request.get("/api/version")).json();
  expect(version.commit).toMatch(/^[0-9a-f]{7}|unknown$/);
});

test("settings simulate brightness, rotation, theme and sleep", async ({ page }) => {
  await openConsole(page);
  await display(page).getByTestId("tab-menu").click();
  await display(page).getByTestId("menu-settings").click();
  await display(page).getByRole("button", { name: "Decrease brightness" }).click();
  await expect(display(page).getByTestId("brightness-value")).toHaveText("80%");
  await display(page).getByTestId("theme").click();
  await expect(display(page)).toHaveAttribute("data-display-theme", "contrast");
  await display(page).getByTestId("rotation").click();
  await expect(display(page).getByTestId("rotation")).toHaveText("180°");
  await display(page).getByTestId("rotation").click();

  await display(page).getByTestId("tab-menu").click();
  await display(page).getByTestId("menu-sleep").click();
  await expect(display(page).getByTestId("sleep-overlay")).toBeVisible();
  // First tap only wakes the screen; it must not trigger the control underneath.
  await display(page)
    .getByTestId("sleep-overlay")
    .click({ position: { x: 32, y: 220 } }); // over the Home tab
  await expect(display(page).getByTestId("sleep-overlay")).toBeHidden();
  await expect(display(page)).toHaveAttribute("data-screen", "menu");
});

test("display-only mode shows no development console", async ({ page }) => {
  await page.goto("/display?scale=1&demo=1");
  await expect(display(page)).toBeVisible();
  await expect(page.getByTestId("simulation-controls")).toHaveCount(0);
  await expect(page.getByTestId("event-log")).toHaveCount(0);
  const box = await display(page).boundingBox();
  expect(box?.width).toBe(320);
});
