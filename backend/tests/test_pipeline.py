from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

SAMPLE_CANVAS_IR = {
    "nodes": [
        {
            "id": "node_1",
            "type": "default",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": "HttpRequest",
                "node_type": "step",
                "namespace": "wpipe_steps.connectivity.http_request",
                "func_name": "HttpRequest",
                "origin": "catalog",
                "contract": {"reads": ["url"], "writes": ["response"]},
            },
        },
        {
            "id": "node_2",
            "type": "default",
            "position": {"x": 150, "y": 0},
            "data": {
                "label": "WafFilter",
                "node_type": "step",
                "namespace": "wpipe_steps.security.waf",
                "func_name": "WafFilterStep",
                "origin": "catalog",
                "contract": {"reads": ["response"], "writes": ["clean_response"]},
            },
        },
    ],
    "edges": [{"id": "edge_1", "source": "node_1", "target": "node_2"}],
    "viewport": {"x": 0, "y": 0, "zoom": 1},
}


def test_validate_pipeline_endpoint():
    response = client.post("/api/v1/pipeline/validate", json=SAMPLE_CANVAS_IR)
    assert response.status_code == 200
    res = response.json()
    assert res["valid"] is True
    assert res["nodes_count"] == 2
    assert res["edges_count"] == 1


def test_transform_pipeline_endpoint():
    response = client.post("/api/v1/pipeline/transform", json=SAMPLE_CANVAS_IR)
    assert response.status_code == 200
    target_ir = response.json()
    assert target_ir["project_name"] == "wpipe_microservice"
    paths = [f["path"] for f in target_ir["files"]]
    assert "app/pipelines.py" in paths
    assert "Dockerfile" in paths


def test_dry_run_pipeline_endpoint():
    response = client.post("/api/v1/pipeline/dry-run", json=SAMPLE_CANVAS_IR)
    assert response.status_code == 200
    res = response.json()
    assert res["status"] == "PASSED"
    assert res["gates"]["dry_run_pipeline"] is True


def test_generate_microservice_zip_endpoint():
    response = client.post("/api/v1/pipeline/generate", json=SAMPLE_CANVAS_IR)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert len(response.content) > 0


def test_transform_while_and_background_endpoint():
    while_bg_ir = {
        "nodes": [
            {
                "id": "node_while",
                "type": "default",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": "While Loop",
                    "node_type": "while",
                    "condition_expression": "retry_count < 3",
                },
            },
            {
                "id": "node_child_1",
                "type": "default",
                "position": {"x": 0, "y": 50},
                "data": {
                    "label": "FetchRetry",
                    "node_type": "step",
                    "namespace": "wpipe_steps.connectivity.http_request",
                    "func_name": "HttpRequest",
                    "parent_id": "node_while",
                    "slot_type": "loop_body",
                },
            },
            {
                "id": "node_bg",
                "type": "default",
                "position": {"x": 0, "y": 100},
                "data": {"label": "Background Task", "node_type": "background"},
            },
            {
                "id": "node_child_2",
                "type": "default",
                "position": {"x": 0, "y": 150},
                "data": {
                    "label": "LogStep",
                    "node_type": "step",
                    "namespace": "wpipe_steps.security.waf",
                    "func_name": "WafFilterStep",
                    "parent_id": "node_bg",
                    "slot_type": "background_body",
                },
            },
        ],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    response = client.post("/api/v1/pipeline/transform", json=while_bg_ir)
    assert response.status_code == 200
    res = response.json()
    pipe_file = next(f for f in res["files"] if f["path"] == "app/pipelines.py")
    assert "Background" in pipe_file["content"]
    assert "For" in pipe_file["content"]
    assert 'validation_expression="retry_count < 3"' in pipe_file["content"]
    assert "Background(" in pipe_file["content"]


def test_transform_kafka_trigger_endpoint():
    kafka_ir = {
        "nodes": [
            {
                "id": "node_trigger",
                "type": "default",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": "Kafka Consumer",
                    "node_type": "trigger",
                    "trigger_type": "kafka",
                    "trigger_param": "orders_topic",
                },
            },
            {
                "id": "node_step",
                "type": "default",
                "position": {"x": 0, "y": 100},
                "data": {
                    "label": "HttpRequest",
                    "node_type": "step",
                    "namespace": "wpipe_steps.connectivity.http_request",
                    "func_name": "HttpRequest",
                },
            },
        ],
        "edges": [{"id": "e1", "source": "node_trigger", "target": "node_step"}],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    response = client.post("/api/v1/pipeline/transform", json=kafka_ir)
    assert response.status_code == 200
    res = response.json()
    main_file = next(f for f in res["files"] if f["path"] == "app/main.py")
    assert "orders_topic" in main_file["content"]
    assert "consume_loop" in main_file["content"]


def test_transform_docker_compose_and_init_files():
    ir = {
        "nodes": [
            {
                "id": "node_trigger",
                "type": "default",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": "API REST",
                    "node_type": "trigger",
                    "trigger_type": "api",
                    "trigger_param": "/run",
                },
            }
        ],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    response = client.post("/api/v1/pipeline/transform", json=ir)
    assert response.status_code == 200
    res = response.json()
    files_map = {f["path"]: f["content"] for f in res["files"]}

    assert "docker-compose.yml" in files_map
    assert "8000:8000" in files_map["docker-compose.yml"]
    assert "healthcheck:" in files_map["docker-compose.yml"]

    assert "app/__init__.py" in files_map
    assert "__version__" in files_map["app/__init__.py"]

    assert "app/dto/__init__.py" in files_map
    assert "app/states/__init__.py" in files_map
    assert "app/tests/__init__.py" in files_map


def test_generate_from_files():
    payload = {
        "project_name": "custom_edited_svc",
        "files": [
            {"path": "app/__init__.py", "content": "# custom edited"},
            {"path": "Dockerfile", "content": "FROM python:3.12-slim\nWORKDIR /app\n"},
            {"path": "docker-compose.yml", "content": "version: '3.8'\n"},
        ],
    }
    response = client.post("/api/v1/pipeline/generate-from-files", json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "custom_edited_svc.zip" in response.headers["content-disposition"]
    assert len(response.content) > 0


def test_transform_preserves_blocks_after_cblock():
    """Verify that blocks following a C-block (e.g.

    Condition/Parallel) are preserved in app/pipelines.py.
    """
    ir = {
        "nodes": [
            {
                "id": "node_1",
                "type": "default",
                "position": {"x": 0, "y": 0},
                "data": {"label": "Trigger", "node_type": "trigger", "trigger_type": "api", "trigger_param": "/run"},
            },
            {
                "id": "node_2",
                "type": "default",
                "position": {"x": 0, "y": 50},
                "data": {"label": "HttpRequest", "node_type": "step", "namespace": "wpipe_steps.connectivity", "func_name": "HttpRequest"},
            },
            {
                "id": "node_3",
                "type": "default",
                "position": {"x": 0, "y": 100},
                "data": {"label": "IF", "node_type": "condition", "condition_expression": "status_code == 200"},
            },
            {
                "id": "node_4",
                "type": "default",
                "position": {"x": 20, "y": 150},
                "data": {"label": "StepInIF", "node_type": "step", "parent_id": "node_3", "slot_type": "if_body", "namespace": "wpipe_steps.database", "func_name": "MySQLQuery"},
            },
            {
                "id": "node_5",
                "type": "default",
                "position": {"x": 0, "y": 200},
                "data": {"label": "StepAfterIF", "node_type": "step", "namespace": "wpipe_steps.network", "func_name": "NmapScanStep"},
            },
        ],
        "edges": [
            {"id": "e1", "source": "node_1", "target": "node_2"},
            {"id": "e2", "source": "node_2", "target": "node_3"},
            {"id": "e3", "source": "node_3", "target": "node_4"},
            {"id": "e4", "source": "node_4", "target": "node_5"},
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    response = client.post("/api/v1/pipeline/transform", json=ir)
    assert response.status_code == 200
    res = response.json()
    pipe_file = next(f for f in res["files"] if f["path"] == "app/pipelines.py")
    content = pipe_file["content"]
    assert "HttpRequest()" in content
    assert "Condition(" in content
    assert "MySQLQuery()" in content
    # Crucial assertion: StepAfterIF must NOT be lost!
    assert "NmapScanStep" in content


def test_transform_microservice_makefile():
    """Verify that Makefile includes container and docker-compose lifecycle targets."""
    ir = {
        "nodes": [
            {
                "id": "node_1",
                "type": "default",
                "position": {"x": 0, "y": 0},
                "data": {"label": "Trigger", "node_type": "trigger", "trigger_type": "api", "trigger_param": "/run"},
            }
        ],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    response = client.post("/api/v1/pipeline/transform", json=ir)
    assert response.status_code == 200
    res = response.json()
    makefile = next(f for f in res["files"] if f["path"] == "Makefile")
    content = makefile["content"]
    assert "start:" in content
    assert "docker-compose up -d --build" in content
    assert "stop:" in content
    assert "docker-compose down" in content
    assert "status:" in content
    assert "docker-compose ps" in content
    assert "logs:" in content
    assert "docker-compose logs -f" in content
    assert "test:" in content
    assert "docker-compose run --rm microservice pytest" in content


def test_transform_with_pipeline_response():
    """Verify that a pipeline with an egress Response node customizes main.py correctly."""
    ir = {
        "nodes": [
            {
                "id": "node_1",
                "type": "default",
                "position": {"x": 0, "y": 0},
                "data": {"label": "Trigger", "node_type": "trigger", "trigger_type": "api", "trigger_param": "/run"},
            },
            {
                "id": "node_2",
                "type": "default",
                "position": {"x": 0, "y": 100},
                "data": {"label": "HttpRequest", "node_type": "step", "namespace": "wpipe_steps.connectivity", "func_name": "HttpRequest"},
            },
            {
                "id": "node_3",
                "type": "default",
                "position": {"x": 0, "y": 200},
                "data": {
                    "label": "Response Egress",
                    "node_type": "response",
                    "response_type": "file_export",
                    "response_param": "audit_output.json",
                },
            },
        ],
        "edges": [
            {"id": "e_1_2", "source": "node_1", "target": "node_2"},
            {"id": "e_2_3", "source": "node_2", "target": "node_3"},
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    response = client.post("/api/v1/pipeline/transform", json=ir)
    assert response.status_code == 200
    res = response.json()

    main_py = next(f for f in res["files"] if f["path"] == "app/main.py")
    assert "audit_output.json" in main_py["content"]
    assert "exported_to" in main_py["content"]

    pipe_py = next(f for f in res["files"] if f["path"] == "app/pipelines.py")
    assert "HttpRequest()" in pipe_py["content"]
    assert "Response" not in pipe_py["content"]

