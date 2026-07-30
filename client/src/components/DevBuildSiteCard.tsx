/**
 * @file DevBuildSiteCard.tsx
 * @description Small orange sidebar card, pinned above the brand block, that
 * tells you whether the current tab is the Vite hot-reload dev server or the
 * built production bundle - both can be served from any port, so the origin
 * alone doesn't tell you which one you're looking at. Detected via
 * `import.meta.env.DEV`, which Vite sets `true` only under `vite dev` and
 * `false` in a `vite build` bundle, regardless of which port serves it.
 * Clicking the inactive segment does a full navigation (`window.location.href`)
 * to the other server's origin, same path and query - a real reload onto the
 * other site rather than an in-app route change.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { Flame, Package } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Fixed in `client/vite.config.ts`'s `server.port` - the dev server's own
 *  conventional port, unlike the backend port which can shift. */
const DEV_PORT = 5173;

/** Full URL for the other site, same path/query, on the port it conventionally
 *  runs on - `__DASHBOARD_PORT__` for the built site (backend origin baked in
 *  at build time), `DEV_PORT` for the dev site. */
function otherSiteUrl(isDev: boolean): string {
  const { protocol, hostname, pathname, search } = window.location;
  const port = isDev ? __DASHBOARD_PORT__ : DEV_PORT;
  return `${protocol}//${hostname}:${port}${pathname}${search}`;
}

/** The dev/built indicator + switcher card. Hidden while the sidebar is
 *  collapsed - same rule as the brand text beneath it. */
export function DevBuildSiteCard() {
  const { t } = useTranslation("nav");
  const isDev = import.meta.env.DEV;

  const goToOtherSite = () => {
    window.location.href = otherSiteUrl(isDev);
  };

  const segment = (label: string, Icon: typeof Flame, active: boolean, switchTitle: string) => (
    <button
      type="button"
      onClick={active ? undefined : goToOtherSite}
      disabled={active}
      aria-pressed={active}
      title={active ? undefined : switchTitle}
      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
        active
          ? "bg-orange-500/25 text-orange-200 cursor-default"
          : "text-orange-500/50 hover:text-orange-300 hover:bg-orange-500/10 cursor-pointer"
      }`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );

  return (
    <div className="mx-3 mt-3 flex-shrink-0">
      <div
        className="flex items-center gap-1 rounded-lg border border-orange-500/30 bg-orange-500/5 p-1"
        title={isDev ? t("devBuildCard.onDevHint") : t("devBuildCard.onBuiltHint")}
      >
        {segment(t("devBuildCard.dev"), Flame, isDev, t("devBuildCard.switchToDev"))}
        {segment(t("devBuildCard.built"), Package, !isDev, t("devBuildCard.switchToBuilt"))}
      </div>
    </div>
  );
}
