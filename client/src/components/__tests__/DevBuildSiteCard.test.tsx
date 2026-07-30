/**
 * @file DevBuildSiteCard.test.tsx
 * @description Unit tests for DevBuildSiteCard - the sidebar card that shows
 * whether the current tab is the Vite dev server or the built production
 * bundle, and switches between them via a full navigation. Vitest runs under
 * Vite's "serve" mode, so `import.meta.env.DEV` is `true` here - the same as
 * a real hot-reload session - making "Hot Reload" the active segment and
 * "Built" the clickable one in every test below.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DevBuildSiteCard } from "../DevBuildSiteCard";

function setLocation(href: string) {
  const url = new URL(href);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      protocol: url.protocol,
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
      href: url.href,
      assign: () => {},
      replace: () => {},
    },
  });
}

describe("DevBuildSiteCard", () => {
  beforeEach(() => {
    setLocation("http://localhost:5173/focus?foo=bar");
  });

  it("renders both segments", () => {
    render(<DevBuildSiteCard />);
    expect(screen.getByText("Hot Reload")).toBeInTheDocument();
    expect(screen.getByText("Built")).toBeInTheDocument();
  });

  it("marks the current mode (dev, under Vitest) as active/disabled and the other as clickable", () => {
    render(<DevBuildSiteCard />);
    const devButton = screen.getByText("Hot Reload").closest("button") as HTMLButtonElement;
    const builtButton = screen.getByText("Built").closest("button") as HTMLButtonElement;
    expect(devButton).toBeDisabled();
    expect(devButton.getAttribute("aria-pressed")).toBe("true");
    expect(builtButton).not.toBeDisabled();
    expect(builtButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("navigates to the built site's origin, preserving the current path and query, when clicked", () => {
    render(<DevBuildSiteCard />);
    fireEvent.click(screen.getByText("Built"));
    expect(window.location.href).toBe("http://localhost:4820/focus?foo=bar");
  });
});
