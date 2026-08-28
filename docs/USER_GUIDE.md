# pktHub — User Guide

This guide is for people who use pktHub to reach and monitor the rest of the pkt suite from one place — not for installing or administering the server. See [ADMIN_GUIDE.md](ADMIN_GUIDE.md) for setup, users, backups, and app registration.

## Logging in

Log in with your username and password, or Okta SSO if configured.

| Action | Admin | Analyst | Viewer |
|---|---|---|---|
| View app registry, dashboards, NOC displays, audit log | ✓ | ✓ | ✓ |
| Act on parts of the app registry | ✓ | ✓ | — |
| Manage Settings, users, app registration | ✓ | — | — |

Analysts see the audit log filtered to only their own entries; admins see everything.

## Navigation

Top to bottom: **Dashboard**, then the **APPS** section (see [Reaching a sibling app](#reaching-a-sibling-app)), then **App Registry** (`/apps`) and **App Alerts** — everything to that point is about the registered apps. Below the rule sit pktHub's own tools: **NOC Screens**, **Audit Log**, and **Settings** (admin only).

APPS collapses as a whole, and each app inside it collapses too — one app's menu is open at a time, so opening another closes it. The sidebar remembers all of that between visits.

Settings has a section bar at the top with **Common** (General, Security, Data, Notifications, User Keys, System — the same in every pkt* app) and **pktHub** (Audit, App Registry, NOC, Maintenance). The tab row below shows one section at a time, so switch sections if a tab looks missing. This is pktHub's own settings — the separate **Reg App Settings** entries further down the nav open other apps' Settings pages.

## Dashboard

An overview of every registered pkt app's health.

## App Registry

Read-only, day-to-day view of every registered app: health status, a link into its proxied UI, and its recent alerts. This is different from **Settings → Security → Suite Integration**, which is where an admin actually registers a new app — App Registry is just for looking, not managing.

## Reaching a sibling app

Under the **APPS** divider in the left nav, each registered app has a collapsible group containing that app's own menu — the same entries you'd see in the app itself. Click one and that app's real page opens in the main area, proxied through pktHub with your pktHub session carrying over, so there's no separate login and no second sidebar. pktHub's menu stays as the only navigation on screen.

One app's menu is open at a time; opening another closes it. If you're on a page and open a different app's menu, the app you're viewing keeps its highlight so you can still see where you are.

Clicking an app's card on the Dashboard, or the open button in the App Registry, takes you to the same place — that app's first page.

An app that doesn't publish a menu has no group under APPS. It still opens from its Dashboard card, just on its root page with no menu to move around by. Admins also get a **Reg App Settings** divider listing those apps' Settings pages.

## NOC Screens / NOC Displays

Lay out widgets pulled from any registered app onto a wallboard-style display. Once built, the display is reachable at a public `/display/:token` URL with **no login required** — designed to be put up on a TV or wallboard. Share that link only with people/screens you're comfortable having unauthenticated access to that specific dashboard.

## Alerts

Recent alerts surfaced from registered apps in one place.

## Audit

A log of administrative actions taken in pktHub. Analysts see only their own entries; admins see everyone's.

## Looking up an IP address

Any IP shown in the app is clickable, opening a lookup combining ipinfo.io, ipapi.is, AbuseIPDB, and MXToolbox data, using **your own** per-user API keys (Settings → User Keys). Private/loopback/reserved addresses aren't looked up — external providers have nothing useful to say about them.

## Your account

Manage your own password from the user menu. Your personal IP-lookup API keys live under Settings → User Keys, private to your account.

## Getting help in the app

Click **Documentation** in the left nav (just above your account info) to open this guide and the Administrator Guide as in-app tabs, so you don't need the repo checked out to read them.
