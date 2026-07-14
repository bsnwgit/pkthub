from pydantic import BaseModel, EmailStr
from typing import Optional, List, Any
from enum import Enum

class UserRole(str, Enum):
    admin = "admin"
    analyst = "analyst"
    viewer = "viewer"

class AppStatus(str, Enum):
    observe = "observe"
    managed = "managed"
    offline = "offline"

class DisplayMode(str, Enum):
    static = "static"
    rotating = "rotating"

# --- Auth ---
class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None
    user_id: Optional[int] = None

# --- Users ---
class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    role: UserRole = UserRole.viewer

class UserUpdate(BaseModel):
    email: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None

class UserOut(BaseModel):
    id: int
    username: str
    email: str
    role: str
    is_active: bool
    created_at: str
    last_login: Optional[str] = None

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

# --- App Registry ---
class AppRegisterRequest(BaseModel):
    name: str
    base_url: str
    description: str = ""
    display_name: Optional[str] = None   # defaults to name if omitted
    app_type: str = "pktapp"
    # Optional: pktHub's own URL as the browser sees it (e.g. https://<server-ip>:8760).
    # When set, the proxy uses this as an absolute base for proxied HTML responses
    # instead of a root-relative path. Useful when the hub hostname doesn't resolve
    # from the server's own DNS but an IP does.
    return_url: Optional[str] = None

class AppUpdateRequest(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    display_name: Optional[str] = None
    description: Optional[str] = None
    return_url: Optional[str] = None

class AppOut(BaseModel):
    id: int
    name: str
    display_name: str
    base_url: str
    app_type: str
    status: str       # observe | managed | offline
    mode: str = ""    # alias populated from status for frontend compat
    health_status: str
    last_health_check: Optional[str] = None
    widget_manifest: List[Any] = []
    supported_versions: List[int] = [1]
    registered_at: str
    return_url: Optional[str] = None

# --- Alert Rules ---
class AlertRuleCreate(BaseModel):
    name: str
    event_type: str
    severity: str = "warning"
    description: str = ""
    enabled: bool = True

class AlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    event_type: Optional[str] = None
    severity: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None

class AlertRuleOut(BaseModel):
    id: int
    name: str
    event_type: str
    severity: str
    description: str
    enabled: bool
    created_at: str
    updated_at: str

class AppStatusUpdate(BaseModel):
    status: AppStatus

# --- Kiosk ---
class KioskWidget(BaseModel):
    id: str
    app_id: int
    widget_type: str
    title: str
    x: int
    y: int
    w: int
    h: int
    config: dict = {}

class KioskSlide(BaseModel):
    id: str
    widgets: List[KioskWidget] = []
    dwell_seconds: int = 30

class KioskCreate(BaseModel):
    name: str
    description: str = ""
    layout: List[Any] = []
    display_mode: DisplayMode = DisplayMode.static
    dwell_seconds: int = 30

class KioskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    layout: Optional[List[Any]] = None
    display_mode: Optional[DisplayMode] = None
    dwell_seconds: Optional[int] = None

class KioskOut(BaseModel):
    id: int
    name: str
    description: str
    layout: List[Any]
    display_mode: str
    dwell_seconds: int
    display_token: Optional[str] = None
    is_published: bool
    published_at: Optional[str] = None
    created_at: str
    updated_at: str

# --- Settings ---
class ConfigItem(BaseModel):
    key: str
    value: str

# --- Audit ---
class AuditEntry(BaseModel):
    id: int
    user_id: Optional[int]
    username: Optional[str]
    action: str
    resource: Optional[str]
    details: dict
    ip_address: Optional[str]
    timestamp: str
