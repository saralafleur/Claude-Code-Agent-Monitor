/**
 * @file Small Feed/Playbook tab bar shared by CoachPage and PlaybookPage.
 * Real routes via `NavLink` (`/coach`, `/coach/playbook`), not JS-only tab
 * state, so the URL stays shareable and browser back/forward work.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function CoachTabs() {
  const { t } = useTranslation("coach");
  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
      isActive ? "bg-accent/15 text-accent" : "text-gray-400 hover:text-gray-200"
    }`;
  return (
    <nav
      role="tablist"
      aria-label={t("tabs.label")}
      className="inline-flex items-center gap-0.5 bg-surface-2 border border-border rounded-lg p-1"
    >
      <NavLink to="/coach" end role="tab" className={tabClass}>
        {t("tabs.feed")}
      </NavLink>
      <NavLink to="/coach/playbook" role="tab" className={tabClass}>
        {t("tabs.playbook")}
      </NavLink>
    </nav>
  );
}
