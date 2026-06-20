import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";

describe("GPS-Mock v3 - App Integration Smoke Tests", () => {
  it("renders the main application layout correctly", async () => {
    await act(async () => {
      render(<App />);
    });

    // Check title in brand
    expect(screen.getByText("GPS-Mock v3")).toBeInTheDocument();

    // Check tabs exist
    expect(screen.getByText("Contrôle")).toBeInTheDocument();
    expect(screen.getByText("Favoris")).toBeInTheDocument();
    expect(screen.getByText("Séquences")).toBeInTheDocument();
    expect(screen.getByText("Réglages")).toBeInTheDocument();
  });

  it("can switch sidebar tabs and displays corresponding menus", async () => {
    await act(async () => {
      render(<App />);
    });

    // Initial state: should show Telemetry card and Injection GPS card
    expect(screen.getByText("Injection GPS")).toBeInTheDocument();

    // Click on Favoris tab
    const favsTab = screen.getByText("Favoris");
    await act(async () => {
      fireEvent.click(favsTab);
    });

    // Should now show Lieux Favoris card
    expect(screen.getByText("Lieux Favoris")).toBeInTheDocument();
    expect(screen.getByText("Paris, FR")).toBeInTheDocument();

    // Click on Réglages tab
    const settingsTab = screen.getByText("Réglages");
    await act(async () => {
      fireEvent.click(settingsTab);
    });

    // Should now show Configuration Moteur card
    expect(screen.getByText("Configuration Moteur")).toBeInTheDocument();
    expect(screen.getByText("Port du Serveur Go")).toBeInTheDocument();
  });
});
