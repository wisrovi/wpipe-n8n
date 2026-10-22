"""Unit tests for WPipe Engine WorkspaceManager.
Tests project creation, listing, updating, duplication, deletion, .env management and terminal execution.
Author: William Rodriguez (wisrovi.dev)
"""

import shutil
import tempfile
from pathlib import Path
from wpipe_engine.core.workspace import WorkspaceManager


def test_workspace_lifecycle():
    temp_dir = Path(tempfile.mkdtemp())
    try:
        mgr = WorkspaceManager(root_dir=temp_dir)

        # 1. Initially empty
        assert len(mgr.list_projects()) == 0

        # 2. Create project
        canvas_ir = {
            "nodes": [
                {"id": "node_1", "data": {"label": "Trigger"}},
                {"id": "node_2", "data": {"label": "HttpRequest"}},
            ],
            "edges": [],
        }
        proj = mgr.create_project(
            name="demo_pipeline",
            description="Test pipeline description",
            docker_image="python:3.11-slim",
            canvas_ir=canvas_ir,
            generated_files=[
                {"name": "main.py", "path": "app/main.py", "content": "print('hello')"},
            ],
        )

        assert proj["name"] == "demo_pipeline"
        assert proj["node_count"] == 2
        proj_id = proj["id"]

        # 3. List projects
        projs = mgr.list_projects()
        assert len(projs) == 1
        assert projs[0]["id"] == proj_id

        # 4. Get project
        loaded = mgr.get_project(proj_id)
        assert loaded is not None
        assert loaded["name"] == "demo_pipeline"
        assert len(loaded["generated_files"]) >= 1

        # 5. Update project
        updated = mgr.update_project(proj_id, {
            "description": "Updated description",
            "canvas_ir": {
                "nodes": [{"id": "node_1", "data": {"label": "Trigger"}}],
                "edges": [],
            },
        })
        assert updated is not None
        assert updated["description"] == "Updated description"
        assert updated["node_count"] == 1

        # 6. Env variables
        env_vars = mgr.get_env_vars(proj_id)
        assert any(v["key"] == "PORT" for v in env_vars)

        mgr.save_env_vars(proj_id, [
            {"key": "DB_URL", "value": "postgres://localhost/mydb"},
            {"key": "PORT", "value": "9000"},
        ])
        new_env = mgr.get_env_vars(proj_id)
        assert any(v["key"] == "DB_URL" and v["value"] == "postgres://localhost/mydb" for v in new_env)

        # 7. Terminal execution
        term_res = mgr.execute_terminal(proj_id, "echo 'wpipe_engine_test'")
        assert "wpipe_engine_test" in term_res["stdout"]
        assert term_res["exit_code"] == 0

        # 8. Duplicate project
        dup = mgr.duplicate_project(proj_id)
        assert dup is not None
        assert "demo_pipeline_copy" in dup["name"]
        assert len(mgr.list_projects()) == 2

        # 9. Delete project
        assert mgr.delete_project(proj_id) is True
        assert mgr.get_project(proj_id) is None
        assert len(mgr.list_projects()) == 1

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
