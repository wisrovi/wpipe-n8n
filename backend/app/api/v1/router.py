import importlib
import pkgutil
from types import ModuleType

from fastapi import APIRouter

from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()

_PACKAGE = importlib.import_module(__package__)
_SELF = __name__.rsplit(".", 1)[-1]


def _import_sibling(name: str) -> ModuleType | None:
    try:
        return importlib.import_module(f"{__package__}.{name}")
    except Exception:
        logger.warning("API module %s failed to import and was skipped", name, exc_info=True)
        return None


def _sibling_modules() -> list[ModuleType]:
    modules: list[ModuleType] = []
    for module_info in sorted(pkgutil.iter_modules(_PACKAGE.__path__), key=lambda info: info.name):
        if module_info.name == _SELF:
            continue
        module = _import_sibling(module_info.name)
        if module is not None:
            modules.append(module)
    return modules


def _collect_routers() -> list[APIRouter]:
    collected: list[APIRouter] = []
    seen: set[int] = {id(router)}
    for module in _sibling_modules():
        for value in vars(module).values():
            if isinstance(value, APIRouter) and id(value) not in seen:
                seen.add(id(value))
                collected.append(value)
    return collected


from app.api.v1.auth import router as auth_router  # noqa: E402
from app.api.v1.catalog import router as catalog_router  # noqa: E402
from app.api.v1.pipeline import router as pipeline_router  # noqa: E402
from app.api.v1.projects import router as projects_router  # noqa: E402

router.include_router(auth_router)
router.include_router(catalog_router)
router.include_router(pipeline_router)
router.include_router(projects_router)

def _mount_siblings() -> None:
    for candidate in _collect_routers():
        if candidate not in (auth_router, catalog_router, pipeline_router, projects_router):
            router.include_router(candidate)
            logger.info("mounted router prefix=%r tags=%r", candidate.prefix, candidate.tags)


_mount_siblings()