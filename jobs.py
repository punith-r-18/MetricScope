
"""Background job manager for MetricScope analyses."""
from __future__ import annotations

import shutil
import tempfile
import threading
import uuid
from pathlib import Path

from core import analyze_project, extract_zip


class JobManager:
    """Run one analysis at a time and keep track of its progress."""

    def __init__(self, reports_dir: str | Path = "reports"):
        self.reports_dir = Path(reports_dir)
        self.reports_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self._active_job: str | None = None

    def get_job(self, job_id: str) -> dict | None:
        """Return a safe copy of a job's current status."""
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def start(self, uploaded_file, filename: str, host: str, token: str,
              scanner: str = "sonar-scanner") -> str:
        """Accept a ZIP upload and start its analysis in a background thread."""
        with self._lock:
            if self._active_job is not None:
                active = self._jobs.get(self._active_job)
                if active and active["status"] in ("queued", "running"):
                    raise RuntimeError("Another analysis is already running.")

            job_id = uuid.uuid4().hex
            self._jobs[job_id] = {
                "id": job_id,
                "status": "queued",
                "step": 0,
                "step_label": "Queued",
                "logs": [],
                "error": None,
                "report_id": None,
            }
            self._active_job = job_id

        thread = threading.Thread(
            target=self._run,
            args=(job_id, uploaded_file, filename, host, token, scanner),
            daemon=True,
        )
        thread.start()
        return job_id

    def _update(self, job_id: str, **changes) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(changes)

    def _log(self, job_id: str, message: str) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id]["logs"].append(message)

    def _run(self, job_id: str, uploaded_file, filename: str,
             host: str, token: str, scanner: str) -> None:
        """Extract, analyse and clean up a project ZIP."""
        temp_dir = None
        try:
            self._update(job_id, status="running")
            self._log(job_id, f"Received upload: {filename}")

            temp_dir = Path(tempfile.mkdtemp(prefix="metricscope_"))
            zip_path = temp_dir / "upload.zip"

            with open(zip_path, "wb") as destination:
                shutil.copyfileobj(uploaded_file, destination)

            project_dir = extract_zip(zip_path, temp_dir / "project")
            if not any(project_dir.iterdir()):
                raise ValueError("The uploaded ZIP archive is empty.")

            def on_step(index: int, label: str) -> None:
                self._update(job_id, step=index, step_label=label)

            def log(message: str) -> None:
                self._log(job_id, message)

            result = analyze_project(
                project_dir=project_dir,
                host=host,
                token=token,
                scanner=scanner,
                project_name=Path(filename).stem,
                log=log,
                reports_dir=self.reports_dir,
                on_step=on_step,
            )

            self._update(
                job_id,
                status="completed",
                step=5,
                step_label="Completed",
                report_id=result["id"],
                result=result,
            )
            self._log(job_id, "Analysis completed successfully.")

        except Exception as exc:  # noqa: BLE001 — background job must record unexpected failures
            self._update(
                job_id,
                status="failed",
                error=str(exc).replace(token, "***"),
            )
            self._log(job_id, f"Analysis failed: {str(exc).replace(token, '***')}")

        finally:
            if temp_dir and temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)

            with self._lock:
                if self._active_job == job_id:
                    self._active_job = None
