"""Multi-Tenant Microservice Projects API Routes."""

from fastapi import APIRouter, Header, HTTPException, status

from app.schemas.projects import (
    ProjectCreateRequest,
    ProjectDetail,
    ProjectSummary,
    ProjectUpdateRequest,
)
from app.services.project_manager import get_project_manager

router = APIRouter(prefix="/projects", tags=["projects"])


def _resolve_user_id(x_user_id: str | None) -> str:
    if x_user_id and x_user_id.strip():
        return x_user_id.strip()
    return "usr_william"


@router.get("", response_model=list[ProjectSummary])
def list_user_projects(x_user_id: str | None = Header(default=None)) -> list[ProjectSummary]:
    """List all microservices/projects belonging strictly to the authenticated user."""
    owner_id = _resolve_user_id(x_user_id)
    pm = get_project_manager()
    return pm.list_projects(owner_id)


@router.post("", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
def create_user_project(
    req: ProjectCreateRequest,
    x_user_id: str | None = Header(default=None),
) -> ProjectDetail:
    """Create a new isolated microservice project in the user's workspace."""
    owner_id = _resolve_user_id(x_user_id)
    pm = get_project_manager()
    try:
        return pm.create_project(owner_id, req)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error al crear microservicio: {e}",
        )


@router.get("/{project_id}", response_model=ProjectDetail)
def get_user_project(
    project_id: str,
    x_user_id: str | None = Header(default=None),
) -> ProjectDetail:
    """Fetch details and files of a microservice, verifying workspace ownership."""
    owner_id = _resolve_user_id(x_user_id)
    pm = get_project_manager()
    project = pm.get_project(project_id, owner_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado en tu espacio de trabajo.",
        )
    return project


@router.put("/{project_id}", response_model=ProjectDetail)
def update_user_project(
    project_id: str,
    req: ProjectUpdateRequest,
    x_user_id: str | None = Header(default=None),
) -> ProjectDetail:
    """Update canvas state, metadata, and generated files of a microservice."""
    owner_id = _resolve_user_id(x_user_id)
    pm = get_project_manager()
    updated = pm.update_project(project_id, owner_id, req)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado o no tienes permiso para modificarlo.",
        )
    return updated


@router.delete("/{project_id}")
def delete_user_project(
    project_id: str,
    x_user_id: str | None = Header(default=None),
) -> dict:
    """Permanently delete a microservice and its workspace directory."""
    owner_id = _resolve_user_id(x_user_id)
    pm = get_project_manager()
    deleted = pm.delete_project(project_id, owner_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado o no autorizado.",
        )
    return {"status": "success", "message": f"Microservicio {project_id} eliminado exitosamente."}


@router.post("/{project_id}/duplicate", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
def duplicate_user_project(
    project_id: str,
    x_user_id: str | None = Header(default=None),
) -> ProjectDetail:
    """Clone an existing microservice into a new independent project."""
    owner_id = _resolve_user_id(x_user_id)
    pm = get_project_manager()
    cloned = pm.duplicate_project(project_id, owner_id)
    if not cloned:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado para clonar.",
        )
    return cloned
