"""WPipe Engine - Pipeline Simulation & Test Runner
Executes microservices, breakpoint inspections and unit test suites locally.
Author: William Rodriguez (wisrovi.dev)
"""

import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any


class LocalRunner:
    """Runs simulation steps and pytest suites against local microservice workspaces."""

    def run_simulation(
        self,
        canvas_ir: dict[str, Any],
        input_payload: dict[str, Any] | None = None,
        breakpoints: list[str] | None = None,
    ) -> dict[str, Any]:
        """Simulate sequential pipeline execution with timing and breakpoint detection."""
        nodes = canvas_ir.get("nodes", [])
        context: dict[str, Any] = dict(input_payload or {})
        timeline: list[dict[str, Any]] = []
        bk_set = set(breakpoints or [])
        paused_at_breakpoint: str | None = None

        start_total = time.perf_counter()

        for node in nodes:
            nid = node.get("id", "")
            data = node.get("data", {})
            label = data.get("label", nid)
            ntype = data.get("node_type", "step")

            # Check if this node has an active breakpoint
            if nid in bk_set:
                paused_at_breakpoint = nid
                timeline.append({
                    "node_id": nid,
                    "label": label,
                    "status": "paused",
                    "duration_ms": 0.0,
                    "message": f"Paused at breakpoint on step: {label}",
                })
                break

            t0 = time.perf_counter()
            # Mock step execution
            if ntype == "trigger":
                context.setdefault("trigger", data.get("trigger_type", "api"))
            elif ntype == "step":
                context[f"output_{label.lower()}"] = f"Processed {label}"
            elif ntype == "condition":
                context["condition_met"] = True

            dur = (time.perf_counter() - t0) * 1000
            timeline.append({
                "node_id": nid,
                "label": label,
                "status": "success",
                "duration_ms": round(dur, 2),
            })

        total_dur = (time.perf_counter() - start_total) * 1000

        return {
            "status": "paused" if paused_at_breakpoint else "success",
            "paused_breakpoint": paused_at_breakpoint,
            "duration_ms": round(total_dur, 2),
            "input_payload": input_payload or {},
            "output_context": context,
            "steps_timeline": timeline,
            "timestamp": time.time(),
        }

    def run_pytest(self, workspace_dir: Path) -> dict[str, Any]:
        """Execute pytest in the given microservice workspace folder and return structured metrics."""
        tests_dir = workspace_dir / "tests"
        if not tests_dir.exists():
            return {
                "total": 0,
                "passed": 0,
                "failed": 0,
                "skipped": 0,
                "duration_sec": 0.0,
                "output": "No se encontró el directorio tests/ en el workspace",
                "status": "failed",
                "exit_code": 1,
            }

        env = os.environ.copy()
        env["PYTHONPATH"] = f"{str(workspace_dir)}:{env.get('PYTHONPATH', '')}"

        t0 = time.perf_counter()
        try:
            res = subprocess.run(
                ["pytest", "tests/", "-v", "--tb=short"],
                cwd=str(workspace_dir),
                capture_output=True,
                text=True,
                timeout=30,
                env=env,
            )
            raw = (res.stdout or "") + ("\n" + res.stderr if res.stderr else "")
            dur = time.perf_counter() - t0

            passed_m = re.search(r"(\d+)\s+passed", raw)
            failed_m = re.search(r"(\d+)\s+failed", raw)
            skipped_m = re.search(r"(\d+)\s+skipped", raw)

            passed = int(passed_m.group(1)) if passed_m else len(re.findall(r" PASSED", raw))
            failed = int(failed_m.group(1)) if failed_m else len(re.findall(r" FAILED", raw))
            skipped = int(skipped_m.group(1)) if skipped_m else len(re.findall(r" SKIPPED", raw))
            total = passed + failed + skipped
            is_success = res.returncode == 0 and failed == 0

            return {
                "total": total,
                "passed": passed,
                "failed": failed,
                "skipped": skipped,
                "duration_sec": round(dur, 2),
                "output": raw,
                "status": "success" if is_success else "failed",
                "exit_code": 0 if is_success else 1,
            }
        except Exception as e:
            return {
                "total": 0,
                "passed": 0,
                "failed": 1,
                "skipped": 0,
                "duration_sec": 0.0,
                "output": f"Error al ejecutar pytest: {e}",
                "status": "failed",
                "exit_code": 1,
            }
