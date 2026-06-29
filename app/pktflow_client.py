"""
pktFlow API client — manages service account JWT and fetches dashboard data.
Tokens expire after 15 min; we re-login at 13 min to stay ahead of expiry.
"""
from __future__ import annotations

import asyncio
import time
import logging
from typing import Any

import httpx

log = logging.getLogger("pktdashboard.client")


class PktFlowClient:
    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self._token: str | None = None
        self._token_expiry: float = 0
        self._lock = asyncio.Lock()

    # ── Auth ──────────────────────────────────────────────────────────────────

    async def _login(self) -> None:
        async with httpx.AsyncClient(timeout=10, verify=False) as client:
            resp = await client.post(
                f"{self.base_url}/api/auth/login",
                json={"username": self.username, "password": self.password},
            )
            resp.raise_for_status()
            data = resp.json()
            self._token = data["access_token"]
            self._token_expiry = time.monotonic() + 13 * 60  # refresh before 15-min expiry
            log.info("pktFlow service account token refreshed")

    async def _ensure_token(self) -> None:
        async with self._lock:
            if self._token and time.monotonic() < self._token_expiry:
                return
            await self._login()

    # ── HTTP ──────────────────────────────────────────────────────────────────

    async def _get(self, path: str, params: dict | None = None) -> Any:
        await self._ensure_token()
        headers = {"Authorization": f"Bearer {self._token}"}
        async with httpx.AsyncClient(timeout=10, verify=False) as client:
            resp = await client.get(
                f"{self.base_url}{path}",
                headers=headers,
                params=params,
            )
            if resp.status_code == 401:
                # Token was rejected — force re-login once
                async with self._lock:
                    self._token = None
                    self._token_expiry = 0
                    await self._login()
                headers = {"Authorization": f"Bearer {self._token}"}
                resp = await client.get(
                    f"{self.base_url}{path}",
                    headers=headers,
                    params=params,
                )
            resp.raise_for_status()
            return resp.json()

    # ── Dashboard data ────────────────────────────────────────────────────────

    async def get_dashboard_data(self) -> dict:
        """Fetch all dashboard data concurrently. Never raises — errors become None."""

        async def safe(coro):
            try:
                return await coro
            except Exception as exc:
                log.warning("pktFlow fetch failed: %s", exc)
                return None

        health, flow_rate, devices, alerts = await asyncio.gather(
            safe(self._get("/api/health")),
            safe(self._get("/api/flows/rate")),
            safe(self._get("/api/flows/devices")),
            safe(self._get("/api/alerts/events", {"unacked_only": "true", "limit": 20})),
        )

        pktflow_up = health is not None and health.get("status") == "ok"

        return {
            "pktflow_up": pktflow_up,
            "health": health,
            "flow_rate": flow_rate or {},
            "devices": devices or [],
            "alerts": alerts or [],
        }
