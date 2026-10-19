"""Unit Tests for WPipe Engine Freemium Quota Limiter
Author: William Rodriguez (wisrovi.dev)
"""

from wpipe_engine.core.limiter import check_compilation_limits, MAX_FREE_BLOCKS


def test_free_tier_within_limits_allowed():
    free_license = {"is_pro": False, "tier": "free", "max_blocks": MAX_FREE_BLOCKS}
    canvas = {
        "nodes": [
            {"id": "n1", "data": {"node_type": "trigger", "label": "Start"}},
            {"id": "n2", "data": {"node_type": "step", "label": "HttpRequest"}},
            {"id": "n3", "data": {"node_type": "step", "label": "CleanData"}},
        ]
    }
    allowed, msg, details = check_compilation_limits(canvas, free_license)
    assert allowed is True
    assert "válido" in msg.lower()


def test_free_tier_exceeding_max_blocks_rejected():
    free_license = {"is_pro": False, "tier": "free", "max_blocks": MAX_FREE_BLOCKS}
    # 6 blocks (exceeds max of 5)
    canvas = {
        "nodes": [
            {"id": f"n{i}", "data": {"node_type": "step", "label": f"Step_{i}"}}
            for i in range(1, 7)
        ]
    }
    allowed, msg, details = check_compilation_limits(canvas, free_license)
    assert allowed is False
    assert details["code"] == "LIMIT_BLOCK_COUNT_EXCEEDED"
    assert details["current_blocks"] == 6
    assert details["max_allowed"] == 5
    assert "wisrovi.dev" in details["upgrade_url"]


def test_free_tier_prohibited_parallel_block_rejected():
    free_license = {"is_pro": False, "tier": "free", "max_blocks": MAX_FREE_BLOCKS}
    canvas = {
        "nodes": [
            {"id": "n1", "data": {"node_type": "trigger", "label": "Start"}},
            {"id": "n2", "data": {"node_type": "wpipe_parallel", "label": "Parallel"}},
        ]
    }
    allowed, msg, details = check_compilation_limits(canvas, free_license)
    assert allowed is False
    assert details["code"] == "PRO_FEATURE_REQUIRED"
    assert details["prohibited_block"] == "wpipe_parallel"


def test_pro_tier_unlimited_blocks_and_parallel_allowed():
    pro_license = {"is_pro": True, "tier": "pro", "max_blocks": None}
    # 15 blocks with parallel and background
    nodes = [
        {"id": f"n{i}", "data": {"node_type": "step", "label": f"Step_{i}"}}
        for i in range(1, 14)
    ]
    nodes.append({"id": "n_par", "data": {"node_type": "wpipe_parallel", "label": "ParallelExec"}})
    nodes.append({"id": "n_bg", "data": {"node_type": "wpipe_background", "label": "BgWorker"}})

    canvas = {"nodes": nodes}
    allowed, msg, details = check_compilation_limits(canvas, pro_license)
    assert allowed is True
    assert details == {}
    assert "ilimitada" in msg.lower()
