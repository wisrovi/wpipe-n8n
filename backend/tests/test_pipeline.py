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
                "contract": {"reads": ["url"], "writes": ["response"]}
            }
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
                "contract": {"reads": ["response"], "writes": ["clean_response"]}
            }
        }
    ],
    "edges": [
        {
            "id": "edge_1",
            "source": "node_1",
            "target": "node_2"
        }
    ],
    "viewport": {"x": 0, "y": 0, "zoom": 1}
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
                }
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
                    "slot_type": "loop_body"
                }
            },
            {
                "id": "node_bg",
                "type": "default",
                "position": {"x": 0, "y": 100},
                "data": {
                    "label": "Background Task",
                    "node_type": "background"
                }
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
                    "slot_type": "background_body"
                }
            }
        ],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1}
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
                }
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
                }
            }
        ],
        "edges": [{"id": "e1", "source": "node_trigger", "target": "node_step"}],
        "viewport": {"x": 0, "y": 0, "zoom": 1}
    }
    response = client.post("/api/v1/pipeline/transform", json=kafka_ir)
    assert response.status_code == 200
    res = response.json()
    main_file = next(f for f in res["files"] if f["path"] == "app/main.py")
    assert "orders_topic" in main_file["content"]
    assert "consume_loop" in main_file["content"]


