
import json
import pathlib
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import server


@pytest.fixture
def client():
    return TestClient(server.app)


@pytest.fixture
def restore_settings():
    original = server.get_settings()

    yield

    with server.settings_lock:
        server.settings.update(original)


def test_health_endpoint(client, monkeypatch):
    class MockResponse:
        def __init__(self, data):
            self.data = data

        def raise_for_status(self):
            pass

        def json(self):
            return self.data

    def mock_get(url, **kwargs):
        if url.endswith("/api/system/status"):
            return MockResponse({"status": "UP"})
        if url.endswith("/api/authentication/validate"):
            return MockResponse({"valid": True})
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(server.requests, "get", mock_get)
    monkeypatch.setattr(server.shutil, "which", lambda _: "scanner")

    response = client.get("/api/health")

    assert response.status_code == 200

    data = response.json()

    assert data["sonar_reachable"] is True
    assert data["sonar_status"] == "UP"
    assert data["token_valid"] is True
    assert data["scanner_found"] is True
    assert data["host"]


def test_settings_does_not_expose_token(client):
    response = client.get("/api/settings")

    assert response.status_code == 200

    data = response.json()

    assert "token" not in data
    assert "token_set" in data
    assert "host" in data
    assert "scanner" in data


def test_save_settings(client, restore_settings):
    response = client.post(
        "/api/settings",
        json={
            "host": "http://localhost:9001/",
            "token": "test-token",
            "scanner": "sonar-scanner"
        }
    )

    assert response.status_code == 200
    assert server.get_settings()["host"] == "http://localhost:9001"
    assert server.get_settings()["token"] == "test-token"


def test_reject_invalid_settings_host(client):
    response = client.post(
        "/api/settings",
        json={
            "host": "localhost:9001",
            "token": "",
            "scanner": "sonar-scanner"
        }
    )

    assert response.status_code == 400


def test_reject_non_zip_upload(client):
    response = client.post(
        "/api/analyze",
        files={
            "file": ("project.txt", b"sample content", "text/plain")
        }
    )

    assert response.status_code == 400
    assert "ZIP" in response.json()["detail"]


def test_reject_missing_analysis_input(client):
    response = client.post("/api/analyze")

    assert response.status_code == 400


def test_reject_nonexistent_folder(client):
    response = client.post(
        "/api/analyze",
        data={"folder": "Z:/MetricScope/nonexistent-folder"}
    )

    assert response.status_code == 400


def test_unknown_job_returns_404(client):
    response = client.get("/api/jobs/unknown-job")

    assert response.status_code == 404


def test_invalid_report_id_returns_400(client):
    response = client.get("/api/reports/invalid-id")

    assert response.status_code == 400


def test_missing_report_returns_404(client):
    response = client.get("/api/reports/123456789")

    assert response.status_code == 404


def test_list_reports(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "REPORTS_DIR", tmp_path)

    report = {
        "id": "123456789",
        "project_name": "Sample Project",
        "timestamp": "2026-10-11T10:00:00",
        "totals": {"sonar_ncloc": 100}
    }

    (tmp_path / "123456789.json").write_text(
        json.dumps(report),
        encoding="utf-8"
    )

    response = client.get("/api/reports")

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["id"] == "123456789"


def test_delete_report(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "REPORTS_DIR", tmp_path)

    report_path = tmp_path / "123456789.json"
    report_path.write_text(
        json.dumps({"id": "123456789"}),
        encoding="utf-8"
    )

    response = client.delete("/api/reports/123456789")

    assert response.status_code == 200
    assert not report_path.exists()


def test_delete_missing_report_returns_404(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "REPORTS_DIR", tmp_path)

    response = client.delete("/api/reports/123456789")

    assert response.status_code == 404
def test_reject_analysis_when_another_job_is_running(monkeypatch, restore_settings):
    import io

    from fastapi.testclient import TestClient

    import server

    with server.settings_lock:
        server.settings["token"] = "test-token"

    def fake_start(*args, **kwargs):
        raise RuntimeError("Another analysis is already running")

    monkeypatch.setattr(server.job_manager, "start", fake_start)

    client = TestClient(server.app)

    response = client.post(
        "/api/analyze",
        files={"file": ("sample.zip", io.BytesIO(b"fake zip content"), "application/zip")},
    )

    assert response.status_code == 409