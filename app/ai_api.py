"""
POST /api/ai/chat — Claude AI assistant endpoint, scoped to pktHub's own data
(registered apps, health status, recent audit activity) rather than any
individual pktApp's telemetry. Requires anthropic_api_key in settings.
"""
from __future__ import annotations

import json
import logging

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_db
from app.auth import get_current_user

router = APIRouter(prefix="/api/ai", tags=["ai"])
log = logging.getLogger("pkthub.ai")

SYSTEM_PROMPT = """You are the assistant integrated into pktHub, the central NOC/SOC hub for the
pktApp suite (pktFlow, pktSNMP, pktLog, pktPcap, pktWiFi, pktIPAM, pktNode, pktSecurity). pktHub itself doesn't collect
network telemetry — it registers those other apps, proxies access to them, tracks their health,
and logs who accessed what. Your job is to help admins and analysts understand pktHub's own
state: which apps are registered and their health/managed-mode status, and what the audit log
shows about recent activity.

You will receive a snapshot of pktHub's current registry and recent audit entries alongside the
user's question. Analyze that data and answer clearly and concisely.

Guidelines:
- Be specific and reference the actual apps/events provided when relevant
- Flag unhealthy or unreachable apps, token mismatches, or unusual audit activity you notice
- For questions about an individual pktApp's own data (SNMP devices, log lines, packet captures,
  IP allocations, WiFi clients), say that's outside pktHub's scope and point the user to that
  app's own AI assistant, if it has one
- Keep responses focused — users are busy
- Use plain text; avoid markdown headers in responses (inline bold is fine)"""

DEFAULT_MODEL = "claude-haiku-4-5-20251001"


class ChatRequest(BaseModel):
    question: str


class ChatResponse(BaseModel):
    answer: str
    tokens_used: int = 0


async def _get_setting(db: aiosqlite.Connection, key: str) -> str | None:
    async with db.execute("SELECT value FROM platform_config WHERE key=?", (key,)) as cur:
        row = await cur.fetchone()
    return row["value"] if row else None


async def _build_context(db: aiosqlite.Connection) -> dict:
    async with db.execute(
        "SELECT name, health_status, status, access_mode FROM registered_apps ORDER BY name"
    ) as cur:
        apps = [dict(r) for r in await cur.fetchall()]

    async with db.execute(
        "SELECT timestamp, username, action, resource FROM audit_log ORDER BY timestamp DESC LIMIT 10"
    ) as cur:
        recent_audit = [dict(r) for r in await cur.fetchall()]

    return {"registered_apps": apps, "recent_audit_log": recent_audit}


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    _: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Send a question + a snapshot of pktHub's registry/audit state to Claude."""
    api_key = await _get_setting(db, "anthropic_api_key")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="AI assistant not configured. Add your Anthropic API key in Settings → Security → AI Assistant.",
        )

    model = await _get_setting(db, "ai_model") or DEFAULT_MODEL
    context = await _build_context(db)
    user_message = f"pktHub state:\n{json.dumps(context, indent=2, default=str)}\n\nQuestion: {body.question}"

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model=model,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        answer = response.content[0].text
        tokens = response.usage.input_tokens + response.usage.output_tokens
        return ChatResponse(answer=answer, tokens_used=tokens)

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"AI chat error: {e}")
        if "authentication" in str(e).lower() or "api_key" in str(e).lower():
            raise HTTPException(status_code=503, detail="Invalid Anthropic API key. Check Settings → Security → AI Assistant.")
        raise HTTPException(status_code=502, detail=f"AI service error: {str(e)[:200]}")
