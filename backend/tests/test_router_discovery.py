import sys
import types
from pathlib import Path

import pytest
from fastapi import APIRouter

from app.api.v1 import router as router_module


def test_import_sibling_skips_failing_module(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    broken = tmp_path / "broken_module.py"
    broken.write_text("raise RuntimeError('boom')\n")
    package = types.ModuleType("fake_pkg")
    package.__path__ = [str(tmp_path)]
    monkeypatch.setitem(sys.modules, "fake_pkg", package)
    monkeypatch.setattr(router_module, "_PACKAGE", package)

    assert router_module._import_sibling("broken_module") is None


def test_collect_routers_ignores_self_and_dedupes(monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = types.ModuleType("fake_pkg.catalog")
    shared = APIRouter()
    catalog.router = shared
    catalog.duplicate = shared
    catalog.not_a_router = object()

    monkeypatch.setattr(router_module, "_sibling_modules", lambda: [catalog])

    collected = router_module._collect_routers()

    assert collected == [shared]