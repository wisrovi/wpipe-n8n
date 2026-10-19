"""User Authentication and Multi-Tenant Identity Routes."""

from fastapi import APIRouter, Header, HTTPException, status

from app.schemas.projects import UserLoginRequest, UserProfile, UserRegisterRequest
from app.services.project_manager import get_project_manager

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/users", response_model=list[UserProfile])
def list_available_users() -> list[UserProfile]:
    """List all registered system users for multi-tenant switching."""
    pm = get_project_manager()
    return pm.list_users()


@router.get("/me", response_model=UserProfile)
def get_current_user(x_user_id: str | None = Header(default=None)) -> UserProfile:
    """Get the currently authenticated user profile based on X-User-ID header."""
    pm = get_project_manager()
    target_id = x_user_id or "usr_william"
    user = pm.get_user_by_id(target_id)
    if not user:
        # Fallback to first user in system
        all_users = pm.list_users()
        if all_users:
            return all_users[0]
        # Auto-create default
        return pm.register_user("william.rodriguez", "William R.", "AI Leader & Solutions Architect")
    return user


@router.post("/login", response_model=UserProfile)
def login_user(req: UserLoginRequest) -> UserProfile:
    """Login or switch to a user by username."""
    pm = get_project_manager()
    user = pm.get_user_by_username(req.username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario '{req.username}' no encontrado. Puedes registrarlo primero.",
        )
    return user


@router.post("/register", response_model=UserProfile, status_code=status.HTTP_201_CREATED)
def register_user(req: UserRegisterRequest) -> UserProfile:
    """Register a new user identity."""
    pm = get_project_manager()
    return pm.register_user(req.username, req.name, req.role)
