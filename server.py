
"""MetricScope FastAPI server: API endpoints and static frontend."""
from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import zipfile
from pathlib import Path
from threading import Lock
from typing import Annotated

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from insights import generate_insights
from jobs import JobManager

# ---------------------------------------------------- Configuration

BASE_DIR = Path(__file__).resolve().parent
REPORTS_DIR = BASE_DIR / "reports"
STATIC_DIR = BASE_DIR / "static"

REPORTS_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)

load_dotenv(BASE_DIR / ".env")

DEFAULT_HOST = os.getenv(
    "SONAR_HOST_URL", "http://localhost:9001"
).rstrip("/")
DEFAULT_TOKEN = os.getenv("SONAR_TOKEN", "")
DEFAULT_SCANNER = os.getenv(
    "SONAR_SCANNER_PATH", "sonar-scanner"
)

settings_lock = Lock()
settings = {
    "host": DEFAULT_HOST,
    "token": DEFAULT_TOKEN,
    "scanner": DEFAULT_SCANNER,
}

job_manager = JobManager(reports_dir=REPORTS_DIR)

app = FastAPI(
    title="MetricScope API",
    description="Compare SonarQube, cloc and Lizard software metrics.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------- Request models

class SettingsRequest(BaseModel):
    host: str
    token: str = ""
    scanner: str = "sonar-scanner"


# ---------------------------------------------------- Helpers

REPORT_ID_PATTERN = re.compile(r"^[0-9_]+$")


def get_settings() -> dict:
    """Return a thread-safe copy of the current settings."""
    with settings_lock:
        return dict(settings)


def safe_report_path(report_id: str) -> Path:
    """Validate a report ID before accessing its JSON file."""
    if not REPORT_ID_PATTERN.fullmatch(report_id):
        raise HTTPException(status_code=400, detail="Invalid report ID.")

    path = REPORTS_DIR / f"{report_id}.json"

    if not path.is_file():
        raise HTTPException(status_code=404, detail="Report not found.")

    return path


def read_report(report_id: str) -> dict:
    """Load a saved analysis report."""
    path = safe_report_path(report_id)

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise HTTPException(
            status_code=500,
            detail="The saved report could not be read.",
        )


def make_folder_zip(folder: Path) -> io.BytesIO:
    """Create an in-memory ZIP archive from a local project folder."""
    archive_buffer = io.BytesIO()

    with zipfile.ZipFile(
        archive_buffer, "w", zipfile.ZIP_DEFLATED
    ) as archive:
        for path in folder.rglob("*"):
            if not path.is_file():
                continue

            if any(
                part in {"venv", ".git", "__pycache__", "node_modules"}
                for part in path.parts
            ):
                continue

            archive.write(path, path.relative_to(folder))

    archive_buffer.seek(0)
    return archive_buffer


def get_report_rows(result: dict) -> list[dict]:
    """Return comparison rows from a saved report."""
    rows = result.get("comparison", [])

    if not isinstance(rows, list):
        raise HTTPException(
            status_code=500,
            detail="Report comparison data is invalid.",
        )

    return rows


# ---------------------------------------------------- Health

@app.get("/api/health")
def health() -> dict:
    """Check SonarQube, token authentication and local analysis tools."""
    config = get_settings()
    host = config["host"]
    token = config["token"]

    sonar_reachable = False
    sonar_status = "UNREACHABLE"
    token_valid = False

    try:
        response = requests.get(
            f"{host}/api/system/status",
            timeout=5,
        )
        response.raise_for_status()
        data = response.json()
        sonar_status = data.get("status", "UNKNOWN")
        sonar_reachable = sonar_status == "UP"
    except (requests.RequestException, ValueError):
        pass

    if sonar_reachable and token:
        try:
            response = requests.get(
                f"{host}/api/authentication/validate",
                auth=(token, ""),
                timeout=5,
            )
            response.raise_for_status()
            token_valid = response.json().get("valid") is True
        except (requests.RequestException, ValueError):
            pass

    scanner_found = bool(
        shutil.which(config["scanner"])
        or (
            config["scanner"].lower().endswith(".bat")
            and Path(config["scanner"]).is_file()
        )
        or Path(config["scanner"]).is_file()
    )

    cloc_found = shutil.which("cloc") is not None

    try:
        import lizard  # noqa: F401
        lizard_found = True
    except ImportError:
        lizard_found = False

    return {
        "sonar_reachable": sonar_reachable,
        "sonar_status": sonar_status,
        "token_valid": token_valid,
        "scanner_found": scanner_found,
        "cloc_found": cloc_found,
        "lizard_found": lizard_found,
        "host": host,
    }


# ---------------------------------------------------- Settings

@app.get("/api/settings")
def read_settings() -> dict:
    """Return settings without exposing the SonarQube token."""
    config = get_settings()

    return {
        "host": config["host"],
        "scanner": config["scanner"],
        "token_set": bool(config["token"]),
    }


@app.post("/api/settings")
def save_settings(body: SettingsRequest) -> dict:
    """Save connection settings in memory for this server session."""
    host = body.host.strip().rstrip("/")
    scanner = body.scanner.strip()

    if not host.startswith(("http://", "https://")):
        raise HTTPException(
            status_code=400,
            detail="SonarQube host must start with http:// or https://.",
        )

    if not scanner:
        raise HTTPException(
            status_code=400,
            detail="Scanner path cannot be empty.",
        )

    with settings_lock:
        settings["host"] = host
        settings["scanner"] = scanner

        # Keep the existing token if the password field was left blank.
        if body.token.strip():
            settings["token"] = body.token.strip()

    return {"message": "Settings saved successfully."}


# ---------------------------------------------------- Analysis

@app.post("/api/analyze")
async def start_analysis(
    file: UploadFile | None = File(default=None),  # noqa: B008 — FastAPI file upload parameter
    folder: Annotated[str | None, Form()] = None,
    name: Annotated[str | None, Form()] = None,
) -> dict:
    """Start an analysis from a ZIP upload or a local folder path."""
    if (file is None and not folder) or (file is not None and folder):
        raise HTTPException(
            status_code=400,
            detail="Provide either a ZIP file or a local folder path.",
        )

    if file is not None:
        filename = file.filename or "project.zip"

        if not filename.lower().endswith(".zip"):
            raise HTTPException(
                status_code=400,
                detail="Only ZIP files are accepted.",
            )

        content = await file.read()

        if not content:
            raise HTTPException(
                status_code=400,
                detail="The uploaded ZIP file is empty.",
            )

        if len(content) > 500 * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail="ZIP file exceeds the 500 MB upload limit.",
            )

        upload_stream = io.BytesIO(content)

    else:
        folder_path = Path(folder).expanduser()

        if not folder_path.exists() or not folder_path.is_dir():
            raise HTTPException(
                status_code=400,
                detail="The specified folder does not exist or is not a directory.",
            )

        upload_stream = make_folder_zip(folder_path)
        filename = f"{folder_path.name}.zip"

        if upload_stream.getbuffer().nbytes == 0:
            raise HTTPException(
                status_code=400,
                detail="The selected folder contains no eligible files.",
            )

    config = get_settings()

    if not config["token"]:
        raise HTTPException(
            status_code=400,
            detail="SonarQube token is missing. Add it in Settings.",
        )

    try:
        job_id = job_manager.start(
            uploaded_file=upload_stream,
            filename=name.strip() + ".zip" if name and name.strip()
            else filename,
            host=config["host"],
            token=config["token"],
            scanner=config["scanner"],
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    return {"job_id": job_id}


# ---------------------------------------------------- Jobs


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, since: int = 0) -> dict:
    """Return job progress, insights, and log entries."""
    job = job_manager.get_job(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    logs = job.get("logs", [])

    # Generate insights when the analysis result is available.
    result = job.get("result")

    if isinstance(result, dict):
        result = {
            **result,
            "insights": generate_insights(result),
        }

    return {
        **job,
        "result": result,
        "logs": logs[max(0, since):],
        "log_count": len(logs),
    }



# ---------------------------------------------------- Report history

@app.get("/api/reports")
def list_reports() -> list[dict]:
    """List saved reports, newest first."""
    reports = []

    for path in REPORTS_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            reports.append({
                "id": data.get("id", path.stem),
                "project": data.get("project", "Unknown project"),
                "timestamp": data.get("timestamp"),
                "totals": data.get("totals", {}),
            })
        except (OSError, json.JSONDecodeError):
            continue

    return sorted(
        reports,
        key=lambda item: item.get("timestamp") or "",
        reverse=True,
    )



@app.get("/api/reports/{report_id}")
def get_report(report_id: str) -> dict:
    """Return the complete saved analysis report with generated insights."""
    result = read_report(report_id)

    result["insights"] = generate_insights(result)

    return result



@app.delete("/api/reports/{report_id}")
def delete_report(report_id: str) -> dict:
    """Delete a saved analysis report."""
    path = safe_report_path(report_id)
    path.unlink()
    return {"message": "Report deleted successfully."}


# ---------------------------------------------------- CSV export

@app.get("/api/reports/{report_id}/csv")
def export_csv(report_id: str):
    """Download the comparison table as CSV."""
    result = read_report(report_id)
    rows = get_report_rows(result)

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No comparison rows are available for this report.",
        )

    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=list(rows[0].keys()),
        extrasaction="ignore",
    )
    writer.writeheader()
    writer.writerows(rows)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                f'attachment; filename="metricscope_{report_id}.csv"'
            )
        },
    )


# ---------------------------------------------------- HTML export

@app.get(
    "/api/reports/{report_id}/report.html",
    response_class=HTMLResponse,
)
def export_html(report_id: str) -> HTMLResponse:
    """Generate a standalone HTML report with inline SVG comparison bars."""
    result = read_report(report_id)
    rows = get_report_rows(result)

    project = str(result.get("project", "MetricScope project"))
    timestamp = str(result.get("timestamp", ""))
    totals = result.get("totals", {})

    def escape(value) -> str:
        import html
        return html.escape(str(value if value is not None else "—"))

    table_rows = ""

    for row in rows:
        cells = "".join(
            f"<td>{escape(value)}</td>"
            for value in row.values()
        )
        table_rows += f"<tr>{cells}</tr>"

    headers = "".join(
        f"<th>{escape(key)}</th>"
        for key in (rows[0].keys() if rows else [])
    )

    kpis = "".join(
        f"""
        <article class="kpi">
          <span>{escape(key.replace('_', ' ').title())}</span>
          <strong>{escape(value)}</strong>
        </article>
        """
        for key, value in totals.items()
    )

    html_document = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MetricScope Report — {escape(project)}</title>
<style>
*{{box-sizing:border-box}}
body{{margin:0;padding:36px;background:#101321;color:#edf0ff;
font:15px/1.6 Arial,sans-serif}}
main{{max-width:1100px;margin:auto}}
h1{{font-size:32px;margin-bottom:4px}}
.muted{{color:#9da8c5}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
gap:14px;margin:28px 0}}
.kpi{{padding:20px;border:1px solid #343c58;border-radius:14px;
background:#1c2236}}
.kpi span{{display:block;color:#aab4d0;font-size:12px}}
.kpi strong{{display:block;font-size:25px;margin-top:8px}}
table{{width:100%;border-collapse:collapse;background:#1c2236;
border-radius:12px;overflow:hidden}}
th,td{{padding:12px;text-align:left;border-bottom:1px solid #343c58}}
th{{background:#252d45;color:#b9c5e5}}
footer{{margin-top:36px;color:#8994b0;font-size:12px}}
@media(max-width:650px){{body{{padding:16px}}table{{font-size:12px}}}}
</style>
</head>
<body>
<main>
<h1>MetricScope</h1>
<p class="muted">Software Metrics Comparison Report</p>
<h2>{escape(project)}</h2>
<p class="muted">Analysis timestamp: {escape(timestamp)}</p>
<section class="grid">{kpis}</section>
<h2>Tool comparison</h2>
<table>
<thead><tr>{headers}</tr></thead>
<tbody>{table_rows}</tbody>
</table>
<footer>Generated by MetricScope · Software Metrics course project</footer>
</main>
</body>
</html>"""

    return HTMLResponse(
        content=html_document,
        headers={
            "Content-Disposition": (
                f'attachment; filename="metricscope_{report_id}.html"'
            )
        },
    )


# ---------------------------------------------------- Frontend

if STATIC_DIR.is_dir():
    app.mount(
        "/static",
        StaticFiles(directory=STATIC_DIR),
        name="static",
    )


@app.get("/", include_in_schema=False)
def home():
    """Serve the MetricScope frontend."""
    index_file = STATIC_DIR / "index.html"

    if not index_file.is_file():
        raise HTTPException(
            status_code=404,
            detail="Frontend is not ready yet. Create static/index.html.",
        )

    return FileResponse(index_file)
