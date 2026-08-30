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

### The widget library

The editor's left panel lists every widget each registered app publishes, grouped by app and then by the app's own category (Overview, Traffic, Alerts, and so on). Use the search box to filter across every app at once — it matches on title, category and description, so searching `throughput` or `expiring` finds the right widget without knowing which app owns it. Click an app's name to collapse its section while you work elsewhere; a search always expands what it matches.

The count beside "Widget Library" is the total available. The **⟳** button re-fetches the manifests from every app — use it if you've just added widgets to an app, or added/removed hardware, and don't want to wait for the next health poll.

### When a widget shows nothing

A tile that shows no data tells you which kind of nothing it is, so a blank panel on a wall is never ambiguous:

| | Meaning |
|---|---|
| **⚙ amber** | The widget needs a filter set — pick the device/subnet/AP in the Filters panel |
| **○ grey** | The query ran and there genuinely is nothing, with the reason stated ("No radio is reporting a noise floor" rather than "No data") |
| **⚠ red** | The query failed, naming the error — this is a fault, not an empty result |

The distinction matters most on an unattended display: a blank tile reads as "all quiet", which is exactly the wrong message if the widget is actually broken.

### Refresh interval

Every widget reloads itself on the interval set in **Settings → NOC → Widget refresh** (default 30s, range 5s–1h). It applies to both the editor preview and published displays.

### Widget filters

Selecting a placed widget shows its **Filters** in the right panel — the choices that widget declares, such as which device, interface, subnet, access point or metric it should show, and over what time window.

These lists are read live from the owning app, so a device enrolled or decommissioned after the screen was built appears (or disappears) the next time you open the picker — press **⟳** to refresh them mid-session. Some filters narrow by another: pick the device before the interface list can populate, and the editor says so rather than sitting on "Loading…". Changing a parent filter clears the ones below it, so a widget can't be left pointing at an interface belonging to a different device.

If a widget on a live display refers to something that has since been deleted, it says so on the tile rather than rendering blank — a blank tile on a wallboard reads as "all quiet", which is exactly the wrong message.

## Alerts

Recent alerts surfaced from registered apps in one place.

## Audit

A log of administrative actions taken in pktHub. Analysts see only their own entries; admins see everyone's.

## The assistant

If an admin has switched it on, a launcher sits in the corner of every page. It is the same assistant the other pkt apps carry — but in pktHub it can see across **every registered app**, so one question can span pktFlow, pktIPAM and the rest rather than being answered app by app.

Ask it things like "how is the estate", "how many subnets are tracked", or "which hosts are lowest on disk".

Some things worth knowing:

- **It reads, it does not change anything.** pktHub publishes no write operations, so it cannot acknowledge an alert or edit a rule from here — do that in the app itself.
- **It only sees what you could see.** Every call carries your identity and role to the app that owns the data, so its own permission rules still apply.
- **It knows a chosen set of operations**, not everything. An admin picks which ones are enabled, so if it says it cannot answer something, that operation probably is not switched on rather than the data being missing.
- **The conversation happens on the resonance server**, not in pktHub. What appears inside the panel is resonance's, so its buttons and wording are not pktHub's to change.
- It never appears on the login page or on a public NOC display.

## Looking up an IP address

Any IP shown in the app is clickable, opening a lookup combining ipinfo.io, ipapi.is, AbuseIPDB, and MXToolbox data, using **your own** per-user API keys (Settings → User Keys). Private/loopback/reserved addresses aren't looked up — external providers have nothing useful to say about them.

## Your account

Manage your own password from the user menu. Your personal IP-lookup API keys live under Settings → User Keys, private to your account.

## Getting help in the app

Click **Documentation** in the left nav (just above your account info) to open this guide and the Administrator Guide as in-app tabs, so you don't need the repo checked out to read them.
