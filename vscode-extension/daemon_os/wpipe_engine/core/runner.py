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
        """Execute the real compiled WPipe microservice pipeline and capture step timeline and errors."""
        import json
        import shutil
        import tempfile
        from .compiler import ASTCompiler

        nodes = canvas_ir.get("nodes", [])
        context: dict[str, Any] = dict(input_payload or {})
        if "transaction_id" not in context:
            context["transaction_id"] = f"sim_{int(time.time() * 1000)}"

        bk_set = set(breakpoints or [])
        paused_at_breakpoint: str | None = None

        # Check early breakpoints on nodes
        for node in nodes:
            nid = node.get("id", "")
            data = node.get("data", {})
            label = data.get("label", nid)
            if nid in bk_set or label in bk_set:
                paused_at_breakpoint = nid
                return {
                    "status": "paused",
                    "paused_breakpoint": paused_at_breakpoint,
                    "duration_ms": 0.0,
                    "input_payload": context,
                    "output_context": context,
                    "steps_timeline": [
                        {
                            "node_id": nid,
                            "label": label,
                            "status": "paused",
                            "duration_ms": 0.0,
                            "message": f"Paused at breakpoint on step: {label}",
                        }
                    ],
                    "timestamp": time.time(),
                }

        start_total = time.perf_counter()

        # 1. Compile the canvas to disk files
        compiler = ASTCompiler()
        project_name = "sim_pipeline"
        try:
            files_dict = compiler.compile_canvas(canvas_ir, project_name=project_name)
        except Exception as comp_err:
            return {
                "status": "error",
                "error": f"Compilation failed: {comp_err}",
                "duration_ms": 0.0,
                "input_payload": context,
                "output_context": context,
                "steps_timeline": [
                    {
                        "node_id": nodes[0].get("id", "comp_err") if nodes else "comp_err",
                        "label": "Compiler",
                        "status": "error",
                        "duration_ms": 0.0,
                        "error": str(comp_err),
                    }
                ],
                "timestamp": time.time(),
            }

        # 2. Write project to sandbox execution directory
        sim_dir = Path.home() / ".wpipe" / "workspaces" / ".sim_sandbox"
        try:
            if sim_dir.exists():
                shutil.rmtree(sim_dir, ignore_errors=True)
            sim_dir.mkdir(parents=True, exist_ok=True)

            for rel_path, content in files_dict.items():
                dest_file = sim_dir / rel_path
                dest_file.parent.mkdir(parents=True, exist_ok=True)
                dest_file.write_text(content, encoding="utf-8")

            # 3. Setup execution environment with wpipe libraries in PYTHONPATH
            env = os.environ.copy()
            wpipe_os_root = Path.home() / "Documents" / "w_libraries" / "wpipe_os"
            extra_paths = [
                str(sim_dir / "app"),
                str(sim_dir),
                str(wpipe_os_root / "wpipe"),
                str(wpipe_os_root / "wpipe-steps"),
                str(wpipe_os_root / "wpipe-plugins" / "src"),
            ]
            env["PYTHONPATH"] = ":".join(p for p in extra_paths if Path(p).exists()) + ":" + env.get("PYTHONPATH", "")

            # 4. Execute app/pipelines.py
            pipelines_file = sim_dir / "app" / "pipelines.py"
            proc = subprocess.run(
                ["python3", str(pipelines_file), json.dumps(context)],
                cwd=str(sim_dir / "app"),
                capture_output=True,
                text=True,
                timeout=45,
                env=env,
            )

            total_dur = (time.perf_counter() - start_total) * 1000
            stdout_str = proc.stdout or ""
            stderr_str = proc.stderr or ""

            # Check if simulation succeeded
            if proc.returncode == 0 and "WPIPE_SIMULATION_SUCCESS" in stdout_str:
                out_ctx = context
                # Parse JSON output from the line following WPIPE_SIMULATION_SUCCESS
                lines = stdout_str.splitlines()
                for i, line in enumerate(lines):
                    if line.strip() == "WPIPE_SIMULATION_SUCCESS" and i + 1 < len(lines):
                        try:
                            out_ctx = json.loads(lines[i + 1])
                        except Exception:
                            pass
                        break

                timeline: list[dict[str, Any]] = []
                # Map step nodes to successful timeline entries
                step_nodes = [
                    n for n in nodes
                    if n.get("data", {}).get("node_type") not in ("trigger", "response", "wpipe_trigger", "wpipe_response")
                ]
                per_step_dur = round(total_dur / max(len(step_nodes), 1), 2)
                for sn in step_nodes:
                    nid = sn.get("id", "")
                    data = sn.get("data", {})
                    lbl = data.get("label") or data.get("step_name") or data.get("func_name") or nid
                    timeline.append({
                        "node_id": nid,
                        "label": lbl,
                        "status": "success",
                        "duration_ms": per_step_dur,
                    })

                return {
                    "status": "success",
                    "duration_ms": round(total_dur, 2),
                    "input_payload": context,
                    "output_context": out_ctx,
                    "steps_timeline": timeline,
                    "stdout": stdout_str,
                    "timestamp": time.time(),
                }
            else:
                # Real execution failed! Find which step failed from stderr
                err_summary = stderr_str.strip() or stdout_str.strip() or "Unknown pipeline runtime error"
                # Extract cleanest error message
                err_msg = err_summary
                for line in reversed(stderr_str.splitlines()):
                    if line.strip() and not line.startswith("Traceback") and not line.startswith("File "):
                        err_msg = line.strip()
                        break

                # Determine which step raised the error by checking traceback from bottom up
                failing_step_label = None
                step_nodes = [
                    n for n in nodes
                    if n.get("data", {}).get("node_type") not in ("trigger", "response", "wpipe_trigger", "wpipe_response")
                ]

                # Match from the deepest traceback lines backwards
                reversed_stderr = "\n".join(reversed(stderr_str.splitlines()))
                for sn in reversed(step_nodes):
                    data = sn.get("data", {})
                    lbl = data.get("label") or data.get("step_name") or data.get("func_name") or ""
                    if lbl and (lbl in stderr_str or lbl.lower() in stderr_str.lower()):
                        failing_step_label = lbl
                        break

                timeline = []
                failed_marked = False
                for sn in step_nodes:
                    nid = sn.get("id", "")
                    data = sn.get("data", {})
                    lbl = data.get("label") or data.get("step_name") or data.get("func_name") or nid
                    if not failed_marked:
                        if failing_step_label and lbl == failing_step_label:
                            timeline.append({
                                "node_id": nid,
                                "label": lbl,
                                "status": "error",
                                "duration_ms": round(total_dur, 2),
                                "error": err_msg,
                            })
                            failed_marked = True
                        elif not failing_step_label and sn == step_nodes[-1]:
                            timeline.append({
                                "node_id": nid,
                                "label": lbl,
                                "status": "error",
                                "duration_ms": round(total_dur, 2),
                                "error": err_msg,
                            })
                            failed_marked = True
                        else:
                            timeline.append({
                                "node_id": nid,
                                "label": lbl,
                                "status": "success",
                                "duration_ms": round(total_dur / max(len(step_nodes), 1), 2),
                            })
                    else:
                        timeline.append({
                            "node_id": nid,
                            "label": lbl,
                            "status": "skipped",
                            "duration_ms": 0.0,
                        })

                return {
                    "status": "error",
                    "error": err_msg,
                    "duration_ms": round(total_dur, 2),
                    "input_payload": context,
                    "output_context": context,
                    "steps_timeline": timeline,
                    "stderr": stderr_str,
                    "stdout": stdout_str,
                    "timestamp": time.time(),
                }
        except subprocess.TimeoutExpired:
            return {
                "status": "error",
                "error": "Pipeline simulation timed out after 45 seconds",
                "duration_ms": 45000.0,
                "input_payload": context,
                "output_context": context,
                "steps_timeline": [],
                "timestamp": time.time(),
            }
        except Exception as ex:
            return {
                "status": "error",
                "error": f"Execution error: {ex}",
                "duration_ms": 0.0,
                "input_payload": context,
                "output_context": context,
                "steps_timeline": [],
                "timestamp": time.time(),
            }
        finally:
            shutil.rmtree(sim_dir, ignore_errors=True)

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
