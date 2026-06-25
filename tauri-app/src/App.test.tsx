import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";

describe("GPS-Mock v3 - App Integration Smoke Tests", () => {
  it("renders the main application shell correctly", async () => {
    await act(async () => {
      render(<App />);
    });

    // Check for search box
    expect(screen.getByPlaceholderText("Rechercher un lieu ou une adresse...")).toBeInTheDocument();
    
    // Check for map style buttons
    expect(screen.getByText("Sombre")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();

    // Check for dock buttons
    expect(screen.getByRole("button", { name: "Réglages" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Journaux" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Favoris" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Périphérique" })).toBeInTheDocument();
  });

  it("can switch app shell sections/modals and displays corresponding content", async () => {
    await act(async () => {
      render(<App />);
    });

    // Open Favorites modal
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Favoris" }));
    });

    expect(screen.getByRole("dialog", { name: "Favoris" })).toBeInTheDocument();
    expect(screen.getByText("Lieux Favoris")).toBeInTheDocument();
    expect(screen.getByText("Paris, FR")).toBeInTheDocument();

    // Close modal
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    });

    // Open Settings modal
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Réglages" }));
    });

    expect(screen.getByRole("dialog", { name: "Réglages" })).toBeInTheDocument();
    expect(screen.getByText("Port d'écoute du moteur")).toBeInTheDocument();
  });

  it("renders advanced map controls when opening the tools panel", async () => {
    await act(async () => {
      render(<App />);
    });

    // Open route tools
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ouvrir les outils de trajet" }));
    });

    // We are now in route mode
    expect(screen.getByRole("tab", { name: "Itinéraire" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Patrouille" })).toBeInTheDocument();
    
    // Check GPX section
    expect(screen.getByText("Importation GPX")).toBeInTheDocument();
    expect(screen.getByText("Cliquez ou glissez un fichier .gpx ici")).toBeInTheDocument();
  });
});
