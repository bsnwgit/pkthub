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

**Dashboard**, **App Registry** (`/apps`), **NOC Builder**, **Alerts**, **Audit**, **Context Viewer**. **Settings** is admin-only.

## Dashboard

An overview of every registered pkt app's health.

## App Registry

Read-only, day-to-day view of every registered app: health status, a link into its proxied UI, and its recent alerts. This is different from **Settings → Security → Suite Integration**, which is where an admin actually registers a new app — App Registry is just for looking, not managing.

## Reaching a sibling app

Click into a registered app from the App Registry or the nav — you're taken into that app's real UI, proxied through pktHub with your pktHub session already carrying over (no separate login for that app). Every app registered in the suite also gets its own **Settings** entry in pktHub's left nav, under a "REG APP SETTINGS" divider — clicking one shows that app's actual live Settings page, embedded full-screen. It's the real app's Settings page, not a copy, so it can never drift out of sync with what that app actually looks like.

## Context Viewer

A standalone view (`/context`) for quickly checking a registered app's status and jumping into it, similar to what's on the Dashboard but focused just on that.

## NOC Builder / NOC Displays

Lay out widgets pulled from any registered app onto a wallboard-style display. Once built, the display is reachable at a public `/display/:token` URL with **no login required** — designed to be put up on a TV or wallboard. Share that link only with people/screens you're comfortable having unauthenticated access to that specific dashboard.

## Alerts

Recent alerts surfaced from registered apps in one place.

## Audit

A log of administrative actions taken in pktHub. Analysts see only their own entries; admins see everyone's.

## Looking up an IP address

Any IP shown in the app is clickable, opening a lookup combining ipinfo.io, ipapi.is, AbuseIPDB, and MXToolbox data, using **your own** per-user API keys (Settings → User Keys). Private/loopback/reserved addresses aren't looked up — external providers have nothing useful to say about them.

## AI Assistant

If your admin has configured an Anthropic API key, an assistant is available to answer questions — see Settings → Security → AI Assistant for where it's configured.

## Your account

Manage your own password from the user menu. Your personal IP-lookup API keys live under Settings → User Keys, private to your account.
