import { expect, test } from "@playwright/test";
import { broadcast, installEngineStub, sentActions, statusPayload } from "./fixtures/engineStub";

// The web build's main surface. These assert the wiring the unit tests can't
// see: that the pairing gate gates, that an envelope reaches the widgets, and
// that the panels open without throwing.

test("an unpaired browser is held at the pairing gate", async ({ page }) => {
  await installEngineStub(page, { paired: false });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Accès distant" })).toBeVisible();
  await expect(page.getByPlaceholder("000000")).toBeVisible();
});

test("a paired browser lands on the map with its chrome", async ({ page }) => {
  await installEngineStub(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Accès distant" })).toHaveCount(0);

  // The floating chrome (MapChrome) and the Leaflet behaviours.
  await expect(page.getByPlaceholder("Rechercher un lieu ou une adresse...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Centrer sur ma position" })).toBeVisible();
  for (const panel of ["Réglages", "Journaux", "Favoris", "Périphérique"]) {
    await expect(page.getByRole("button", { name: panel, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Zoom avant" })).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
});

test("the map style picker swaps the tile source", async ({ page }) => {
  await installEngineStub(page);
  await page.goto("/");

  const tile = page.locator(".leaflet-tile-pane img").first();
  await expect(tile).toHaveAttribute("src", /carto/i);

  await page.getByRole("button", { name: "Plan" }).click();

  await expect(page.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".leaflet-tile-pane img").first()).toHaveAttribute(
    "src",
    /openstreetmap/i,
  );
});

// The client greets a fresh connection by asking for the current state; the
// widgets are empty until it does.
test("the client asks for status and logs on connect", async ({ page }) => {
  await installEngineStub(page);
  await page.goto("/");
  await expect(page.locator(".leaflet-container")).toBeVisible();

  const types = (await sentActions(page)).map((a) => a.type);
  expect(types).toContain("GET_STATUS");
  expect(types).toContain("GET_LOGS");
});

// A STATUS envelope has to reach the UI, not just the store — this is the path
// that the transport refactor moved into engineEventDispatch.
test("a STATUS broadcast reaches the simulation controls", async ({ page }) => {
  await installEngineStub(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Réglages", exact: true }).click();
  await page.getByRole("button", { name: /Simulation/ }).click();

  // Nothing is playing yet, so the transport controls stay hidden.
  await expect(page.getByRole("button", { name: /Pause/ })).toHaveCount(0);

  await broadcast(page, "STATUS", statusPayload({ state: "moving" }));

  await expect(page.getByRole("button", { name: /Pause/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Stop/ })).toBeVisible();
});

// The pre-flight report is the answer to "why won't it inject?", so it has to
// reach the panel — and say which step is missing, not just that something is.
test("the diagnostics panel shows the pre-flight prerequisites", async ({ page }) => {
  await installEngineStub(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Réglages", exact: true }).click();
  await page.getByRole("button", { name: /Diagnostics/ }).click();

  await broadcast(page, "DIAGNOSTICS", {
    goIosPath: "C:/ios.exe",
    pmd3Path: "python",
    lockdownDir: "C:/ProgramData/Apple/Lockdown",
    pairingRecords: [],
    usbDevices: [],
    readiness: {
      ready: false,
      requirements: [
        { id: "device", label: "iPhone détecté", status: "ok", detail: "iPhone détecté." },
        {
          id: "developer-mode",
          label: "Mode développeur activé",
          status: "failed",
          detail: "Le mode développeur est désactivé.",
          fix: "Sur l'iPhone : Réglages → Confidentialité et sécurité → Mode développeur.",
        },
      ],
    },
  });

  await expect(page.getByText("injection impossible en l'état")).toBeVisible();
  await expect(page.getByText("Mode développeur activé")).toBeVisible();
  // The remediation is the point: a failing check must say what to do.
  await expect(page.getByText(/Confidentialité et sécurité/)).toBeVisible();
  // ...and a passing one must not, or it reads like a warning.
  await expect(page.getByRole("img", { name: "conforme" })).toBeVisible();
  await expect(page.getByRole("img", { name: "bloquant" })).toBeVisible();
});
