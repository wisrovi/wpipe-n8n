"""User Authentication and Multi-Tenant Identity Routes."""

from fastapi import APIRouter, Header, HTTPException, status

from app.schemas.projects import (
    AuthTokenResponse,
    UserLoginRequest,
    UserProfile,
    UserRegisterRequest,
)
from app.services.project_manager import get_project_manager

router = APIRouter(prefix="/auth", tags=["auth"])


def _extract_token(authorization: str | None, x_session_token: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    if x_session_token and x_session_token.strip():
        return x_session_token.strip()
    return None


@router.get("/users", response_model=list[UserProfile])
def list_available_users() -> list[UserProfile]:
    """List all registered system users for multi-tenant switching and overview."""
    pm = get_project_manager()
    return pm.list_users()


@router.get("/me", response_model=UserProfile)
def get_current_user(
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> UserProfile:
    """Get the currently authenticated user profile based on Bearer token, session token or user ID."""
    pm = get_project_manager()
    token = _extract_token(authorization, x_session_token)
    if token:
        user = pm.get_user_by_token(token)
        if user:
            return user

    target_id = x_user_id or "usr_william"
    user = pm.get_user_by_id(target_id)
    if not user:
        all_users = pm.list_users()
        if all_users:
            return all_users[0]
        user, _ = pm.register_user("william.rodriguez", "admin123", "William R.", "AI Leader & Solutions Architect")
    return user


@router.post("/login", response_model=AuthTokenResponse)
def login_user(req: UserLoginRequest) -> AuthTokenResponse:
    """Login with username and password, returning a secure session token and user profile."""
    pm = get_project_manager()
    result = pm.authenticate_user(req.username, req.password)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas. Verifica tu usuario y contraseña.",
        )
    user, token = result
    return AuthTokenResponse(token=token, user=user, message=f"Bienvenido de nuevo, {user.name}")


@router.post("/register", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
def register_user(req: UserRegisterRequest) -> AuthTokenResponse:
    """Register a new user identity with password, returning an active session token."""
    pm = get_project_manager()
    user, token = pm.register_user(
        username=req.username,
        password=req.password,
        name=req.name,
        role=req.role,
    )
    return AuthTokenResponse(token=token, user=user, message=f"Usuario {user.name} registrado con éxito")


@router.post("/logout")
def logout_user(
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
) -> dict:
    """Logout and revoke the session token."""
    pm = get_project_manager()
    token = _extract_token(authorization, x_session_token)
    if token:
        pm.logout_token(token)
    return {"status": "success", "message": "Sesión cerrada correctamente"}
