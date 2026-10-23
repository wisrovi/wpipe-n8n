"""Multi-Tenant Microservice Projects API Routes."""

from fastapi import APIRouter, Header, HTTPException, status

from app.schemas.projects import (
    EnvVarsResponse,
    EnvVarsUpdateRequest,
    ProjectCreateRequest,
    ProjectDetail,
    ProjectSummary,
    ProjectUpdateRequest,
    SimulationRunCreate,
    SimulationRunDetail,
    TerminalCommandRequest,
    TerminalCommandResponse,
    TestRunResponse,
)
from app.services.project_manager import get_project_manager

router = APIRouter(prefix="/projects", tags=["projects"])


def _resolve_user_id(
    authorization: str | None,
    x_session_token: str | None,
    x_user_id: str | None,
) -> str:
    pm = get_project_manager()
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif x_session_token and x_session_token.strip():
        token = x_session_token.strip()

    if token:
        user = pm.get_user_by_token(token)
        if user:
            return user.id

    if x_user_id and x_user_id.strip():
        return x_user_id.strip()
    return "usr_william"


@router.get("", response_model=list[ProjectSummary])
def list_user_projects(
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> list[ProjectSummary]:
    """List all microservices/projects belonging strictly to the authenticated user."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
    pm = get_project_manager()
    return pm.list_projects(owner_id)


@router.post("", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
def create_user_project(
    req: ProjectCreateRequest,
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> ProjectDetail:
    """Create a new isolated microservice project in the user's workspace."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
    pm = get_project_manager()
    try:
        return pm.create_project(owner_id, req)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error al crear microservicio: {e}",
        ) from e


@router.get("/{project_id}", response_model=ProjectDetail)
def get_user_project(
    project_id: str,
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> ProjectDetail:
    """Fetch details and files of a microservice, verifying workspace ownership."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
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
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> ProjectDetail:
    """Update canvas state, metadata, and generated files of a microservice."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
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
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> dict:
    """Permanently delete a microservice and its workspace directory."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
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
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> ProjectDetail:
    """Clone an existing microservice into a new independent project."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
    pm = get_project_manager()
    cloned = pm.duplicate_project(project_id, owner_id)
    if not cloned:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado para clonar.",
        )
    return cloned


# ---------------- Simulation History Endpoints ----------------


@router.post("/{project_id}/simulations", response_model=SimulationRunDetail, status_code=status.HTTP_201_CREATED)
def create_simulation_record(
    project_id: str,
    req: SimulationRunCreate,
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> SimulationRunDetail:
    """Save a completed simulation execution run to PostgreSQL."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
    pm = get_project_manager()
    project = pm.get_project(project_id, owner_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado.",
        )
    return pm.save_simulation(project_id, req)


@router.get("/{project_id}/simulations", response_model=list[SimulationRunDetail])
def list_simulation_records(
    project_id: str,
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> list[SimulationRunDetail]:
    """List simulation history for a microservice."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
    pm = get_project_manager()
    project = pm.get_project(project_id, owner_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado.",
        )
    return pm.list_simulations(project_id)


@router.get("/{project_id}/simulations/{sim_id}", response_model=SimulationRunDetail)
def get_simulation_record(
    project_id: str,
    sim_id: str,
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> SimulationRunDetail:
    """Retrieve details of a single simulation run."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
    pm = get_project_manager()
    project = pm.get_project(project_id, owner_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado.",
        )
    sim = pm.get_simulation(sim_id)
    if not sim:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Simulación '{sim_id}' no encontrada.",
        )
    return sim


# ---------------- Terminal & Shell Execution Endpoints ----------------


@router.post("/{project_id}/terminal", response_model=TerminalCommandResponse)
def execute_terminal_command(
    project_id: str,
    req: TerminalCommandRequest,
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> TerminalCommandResponse:
    """Execute a shell command inside the microservice workspace directory."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
    pm = get_project_manager()
    project = pm.get_project(project_id, owner_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado.",
        )
    return pm.run_terminal_command(owner_id, project_id, req.command)


# ---------------- Test Runner (pytest) Endpoints ----------------


@router.post("/{project_id}/run-tests", response_model=TestRunResponse)
def execute_project_tests(
    project_id: str,
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> TestRunResponse:
    """Run pytest suite in the microservice workspace and return parsed results."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
    pm = get_project_manager()
    project = pm.get_project(project_id, owner_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado.",
        )
    return pm.run_project_tests(owner_id, project_id)


# ---------------- Environment Variables (.env) Endpoints ----------------


@router.get("/{project_id}/env", response_model=EnvVarsResponse)
def get_environment_variables(
    project_id: str,
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> EnvVarsResponse:
    """Read .env configuration variables for the microservice."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
    pm = get_project_manager()
    project = pm.get_project(project_id, owner_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado.",
        )
    vars_list = pm.get_project_env(owner_id, project_id)
    return EnvVarsResponse(variables=vars_list)


@router.post("/{project_id}/env", response_model=EnvVarsResponse)
def update_environment_variables(
    project_id: str,
    req: EnvVarsUpdateRequest,
    authorization: str | None = Header(default=None),
    x_session_token: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> EnvVarsResponse:
    """Update .env configuration file in the microservice workspace."""
    owner_id = _resolve_user_id(authorization, x_session_token, x_user_id)
    pm = get_project_manager()
    project = pm.get_project(project_id, owner_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Microservicio '{project_id}' no encontrado.",
        )
    updated = pm.update_project_env(owner_id, project_id, req.variables)
    return EnvVarsResponse(variables=updated)

