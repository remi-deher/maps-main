import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";

describe("GPS-Mock v3 - App Integration Smoke Tests", () => {
  it("renders the main application shell correctly", async () => {
    await act(async () => {
      render(<App />);
    });

    expect(screen.getByText("GPS-Mock v3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pilotage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pilotage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trajets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Favoris" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Journaux" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réglages" })).toBeInTheDocument();
  });

  it("can switch app shell sections and displays corresponding menus", async () => {
    await act(async () => {
      render(<App />);
    });

    expect(screen.getByText("Injection GPS")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Favoris" }));
    });

    expect(screen.getByText("Lieux Favoris")).toBeInTheDocument();
    expect(screen.getByText("Paris, FR")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Réglages" }));
    });

    expect(screen.getByText("Configuration moteur")).toBeInTheDocument();
    expect(screen.getByText("Port RSD (annoté dans le statut)")).toBeInTheDocument();
  });

  it("renders new advanced map controls (Search, Styles, Draw, GPX)", async () => {
    await act(async () => {
      render(<App />);
    });

    expect(screen.getByPlaceholderText("Rechercher un lieu ou une adresse...")).toBeInTheDocument();
    expect(screen.getByText("Sombre")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Trajets" }));
    });

    expect(screen.getByText("Dessin d'Itinéraire")).toBeInTheDocument();
    expect(screen.getByText("Importation GPX")).toBeInTheDocument();
    expect(screen.getByText("Cliquez ou glissez un fichier .gpx ici")).toBeInTheDocument();
  });
});
