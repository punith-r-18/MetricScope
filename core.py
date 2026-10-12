
"""Core logic: analyse a project with SonarQube, cloc and Lizard, then compare."""
from __future__ import annotations

import csv
import json
import re
import shutil
import subprocess
import time
import zipfile
from datetime import datetime
from pathlib import Path

import requests

# Same exclusions are given to every tool so the comparison is fair.
EXCLUDE_DIRS = [
    "node_modules", ".git", ".scannerwork", "venv", ".venv", "target",
    "build", "dist", "__pycache__", ".idea", ".vscode",
]
SONAR_EXCLUSIONS = ",".join(f"**/{d}/**" for d in EXCLUDE_DIRS)

SONAR_METRICS = [
    "files", "lines", "ncloc", "comment_lines", "functions", "classes",
    "statements", "complexity", "cognitive_complexity",
    "duplicated_lines_density", "bugs", "vulnerabilities", "code_smells",
    "sqale_index", "ncloc_language_distribution",
]

# cloc language name -> SonarQube language key
CLOC_TO_SONAR = {
    "Python": "py", "Java": "java", "JavaScript": "js", "JSX": "js",
    "TypeScript": "ts", "TSX": "ts", "C#": "cs", "PHP": "php", "Go": "go",
    "Kotlin": "kotlin", "Ruby": "ruby", "Scala": "scala", "Swift": "swift",
    "HTML": "web", "CSS": "css", "XML": "xml", "YAML": "yaml", "JSON": "json",
    "C": "c", "C++": "cpp", "Objective-C": "objc", "Dockerfile": "docker",
}


# ----------------------------------------------------------------- helpers
def make_key(name: str) -> str:
    """SonarQube project keys allow letters, digits, - _ . :"""
    return "mc-" + re.sub(r"[^A-Za-z0-9_.:-]", "-", name)


def extract_zip(file_obj, dest: str | Path) -> Path:
    """Extract a zip and return the real project root (skips a single wrapper folder)."""
    dest = Path(dest)
    with zipfile.ZipFile(file_obj) as zf:
        zf.extractall(dest)
    entries = [p for p in dest.iterdir() if p.name != "__MACOSX"]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return dest


# ---------------------------------------------------------------- SonarQube
def run_scanner(project_dir: Path, host: str, token: str, key: str,
                scanner: str = "sonar-scanner") -> str:
    exe = shutil.which(scanner) or scanner
    cmd = [
        exe,
        f"-Dsonar.projectKey={key}",
        f"-Dsonar.projectName={key}",
        "-Dsonar.sources=.",
        f"-Dsonar.host.url={host}",
        f"-Dsonar.token={token}",
        f"-Dsonar.exclusions={SONAR_EXCLUSIONS}",
        "-Dsonar.java.binaries=.",
        "-Dsonar.sourceEncoding=UTF-8",
        "-Dsonar.scm.disabled=true",
    ]
    try:
        proc = subprocess.run(
    cmd,
    cwd=project_dir,
    capture_output=True,
    text=True,
    check=False,
)
    except FileNotFoundError:
        raise RuntimeError(
            "sonar-scanner not found. Install it and add it to PATH, "
            "or set SONAR_SCANNER_PATH to its full path."
        )
    if proc.returncode != 0:
        # ADDED: Never expose the SonarQube token in error output.
        error_text = (proc.stdout + proc.stderr).replace(token, "***")
        raise RuntimeError("SonarScanner failed:\n" + error_text[-3000:])
    return proc.stdout


def wait_for_analysis(project_dir: Path, host: str, auth, timeout: int = 600) -> None:
    report = Path(project_dir) / ".scannerwork" / "report-task.txt"
    props = dict(
        line.split("=", 1) for line in report.read_text().splitlines() if "=" in line
    )
    task_id = props["ceTaskId"]
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(
            f"{host}/api/ce/task",
            params={"id": task_id},
            auth=auth,
            timeout=30,
        )
        r.raise_for_status()
        status = r.json()["task"]["status"]
        if status == "SUCCESS":
            return
        if status in ("FAILED", "CANCELED"):
            raise RuntimeError(
                f"SonarQube background task ended with status {status}"
            )
        time.sleep(2)
    raise TimeoutError("SonarQube did not finish processing in time")


def fetch_measures(host: str, auth, key: str) -> dict:
    r = requests.get(
        f"{host}/api/measures/component",
        params={"component": key, "metricKeys": ",".join(SONAR_METRICS)},
        auth=auth,
        timeout=30,
    )
    r.raise_for_status()
    out: dict = {}
    for m in r.json()["component"]["measures"]:
        value = m.get("value")
        if value is None:
            continue
        if m["metric"] == "ncloc_language_distribution":
            out[m["metric"]] = {
                p.split("=")[0]: int(p.split("=")[1])
                for p in value.split(";") if "=" in p
            }
        else:
            out[m["metric"]] = float(value)
    return out


# --------------------------------------------------------------------- cloc
def run_cloc(path: Path) -> dict:
    """Returns {language: {nFiles, blank, comment, code}}"""
    exe = shutil.which("cloc")
    if not exe:
        raise RuntimeError(
            "cloc not found. Install it (see README) and make sure it is on PATH."
        )
    cmd = [
        exe, "--json", "--quiet",
        f"--exclude-dir={','.join(EXCLUDE_DIRS)}", str(path)
    ]
    proc = subprocess.run(
    cmd,
    capture_output=True,
    text=True,
    check=False,
)
    if proc.returncode != 0:
        raise RuntimeError("cloc failed:\n" + proc.stderr[-2000:])
    if not proc.stdout.strip():
        return {}
    data = json.loads(proc.stdout)
    return {k: v for k, v in data.items() if k not in ("header", "SUM")}


# ------------------------------------------------------------------ Lizard
def run_lizard(path: Path) -> dict:
    import lizard

    patterns = []
    for d in EXCLUDE_DIRS:
        patterns += [f"*/{d}/*", f"*\\{d}\\*"]
    files = nloc = funcs = ccn = 0
    for f in lizard.analyze([str(path)], exclude_pattern=patterns):
        files += 1
        nloc += f.nloc
        funcs += len(f.function_list)
        ccn += sum(fn.cyclomatic_complexity for fn in f.function_list)
    return {"files": files, "nloc": nloc, "functions": funcs, "ccn": ccn}


# --------------------------------------------------------------- comparison
def _diff(sonar, other):
    if sonar in (None, 0) or other is None:
        return None
    return round((other - sonar) / sonar * 100, 2)


def build_comparison(sonar: dict, cloc: dict, liz: dict) -> list[dict]:
    sonar_langs = set(sonar.get("ncloc_language_distribution", {}))
    raw = {"files": 0, "lines": 0, "code": 0, "comment": 0}
    aligned = dict(raw)
    for lang, v in cloc.items():
        lines = v["blank"] + v["comment"] + v["code"]
        for bucket, applies in (
            (raw, True),
            (aligned, CLOC_TO_SONAR.get(lang) in sonar_langs),
        ):
            if applies:
                bucket["files"] += v["nFiles"]
                bucket["lines"] += lines
                bucket["code"] += v["code"]
                bucket["comment"] += v["comment"]

    def row(metric, s, c_raw, c_al, l):
        return {
            "Metric": metric,
            "SonarQube": s,
            "cloc (all files)": c_raw,
            "cloc (Sonar languages)": c_al,
            "Lizard": l,
            "Diff % cloc vs Sonar": _diff(s, c_al),
            "Diff % Lizard vs Sonar": _diff(s, l),
        }

    return [
        row("Files", sonar.get("files"), raw["files"], aligned["files"], liz["files"]),
        row("Total lines", sonar.get("lines"), raw["lines"], aligned["lines"], None),
        row(
            "Code lines (LOC/NCLOC)", sonar.get("ncloc"),
            raw["code"], aligned["code"], liz["nloc"]
        ),
        row(
            "Comment lines", sonar.get("comment_lines"),
            raw["comment"], aligned["comment"], None
        ),
        row("Functions", sonar.get("functions"), None, None, liz["functions"]),
        row("Cyclomatic complexity", sonar.get("complexity"), None, None, liz["ccn"]),
    ]


# ------------------------------------------------------------- orchestration
def analyze_project(
    project_dir,
    host: str,
    token: str,
    scanner: str = "sonar-scanner",
    project_name: str | None = None,
    log=print,
    reports_dir: str | Path = "reports",
    on_step=None,  # ADDED: optional progress callback
) -> dict:
    """Run all three analysis tools and save a timestamped comparison report."""
    started = time.time()  # ADDED
    project_dir = Path(project_dir).resolve()
    if not project_dir.is_dir():
        raise FileNotFoundError(f"Not a folder: {project_dir}")
    host = host.rstrip("/")
    key = make_key(project_name or project_dir.name)
    auth = (token, "")

    def step(index: int, label: str) -> None:
        """ADDED: Notify the job manager when a stage begins."""
        if on_step:
            on_step(index, label)

    step(1, "SonarScanner")
    log(f"[1/5] Running SonarScanner (project key: {key}) ...")
    run_scanner(project_dir, host, token, key, scanner)

    step(2, "Processing SonarQube results")
    log("[2/5] Waiting for SonarQube to process the report ...")
    wait_for_analysis(project_dir, host, auth)
    sonar = fetch_measures(host, auth, key)

    step(3, "cloc")
    log("[3/5] Running cloc ...")
    cloc = run_cloc(project_dir)

    step(4, "Lizard")
    log("[4/5] Running Lizard ...")
    liz = run_lizard(project_dir)

    step(5, "Comparing")
    log("[5/5] Building comparison ...")

    # ADDED: Stable timestamp-based report ID and duration.
    timestamp_now = datetime.now()
    report_id = timestamp_now.strftime("%Y%m%d_%H%M%S")
    duration = round(time.time() - started, 2)

    result = {
        "id": report_id,
        "project": project_name or project_dir.name,
        "sonar_key": key,
        "timestamp": timestamp_now.isoformat(timespec="seconds"),
        "duration_seconds": duration,
        "totals": {
            "sonar_ncloc": sonar.get("ncloc"),
            "cloc_code": sum(v.get("code", 0) for v in cloc.values()),
            "lizard_nloc": liz.get("nloc"),
        },
        "comparison": build_comparison(sonar, cloc, liz),
        "sonar_raw": sonar,
        "cloc_by_language": cloc,
        "lizard": liz,
    }

    out = Path(reports_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{report_id}.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    log(f"Report saved: {report_id}.json")
    return result


def write_csv(rows: list[dict], path: str | Path) -> None:
    """Write comparison rows to a CSV file."""
    if not rows:
        raise ValueError("No comparison rows to write.")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
