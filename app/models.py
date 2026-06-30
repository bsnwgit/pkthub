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
    display_name: str
    base_url: str
    app_type: str

class AppOut(BaseModel):
    id: int
    name: str
    display_name: str
    base_url: str
    app_type: str
    status: str
    health_status: str
    last_health_check: Optional[str] = None
    widget_manifest: List[Any] = []
    supported_versions: List[int] = [1]
    registered_at: str

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
