
/**
 * MetricScope API client
 * Centralised communication with the FastAPI backend.
 */

const API_BASE = "/api";

// ---------- Core request helper ----------

async function request(endpoint, options = {}) {
    let response;

    try {
        response = await fetch(`${API_BASE}${endpoint}`, options);
    } catch (error) {
        throw new Error(
            "Cannot connect to MetricScope backend. Make sure the server is running."
        );
    }

    const contentType = response.headers.get("content-type") || "";

    let data;

    if (contentType.includes("application/json")) {
        data = await response.json();
    } else {
        data = await response.text();
    }

    if (!response.ok) {
        const message =
            typeof data === "object" && data !== null
                ? data.detail || data.message
                : data;

        throw new Error(message || `Request failed (${response.status}).`);
    }

    return data;
}

// ---------- Health ----------

/**
 * Check backend, SonarQube and local analysis tools.
 */
export async function getHealth() {
    return request("/health");
}

// ---------- Settings ----------

/**
 * Retrieve connection settings.
 * The backend never returns the actual SonarQube token.
 */
export async function getSettings() {
    return request("/settings");
}

/**
 * Save connection settings.
 * A blank token keeps the existing token on the backend.
 */
export async function saveSettings(settings) {
    return request("/settings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            host: settings.host,
            token: settings.token || "",
            scanner: settings.scanner,
        }),
    });
}

// ---------- Project analysis ----------

/**
 * Start an analysis using either a ZIP upload or a local folder path.
 *
 * ZIP mode:
 *   startAnalysis({ file, name })
 *
 * Folder mode:
 *   startAnalysis({ folder, name })
 *
 * Returns: { job_id }
 */
export async function startAnalysis({ file = null, folder = "", name = "" }) {
    const formData = new FormData();

    if (file) {
        formData.append("file", file);
    } else if (folder.trim()) {
        formData.append("folder", folder.trim());
    } else {
        throw new Error("Select a ZIP file or enter a project folder path.");
    }

    if (name.trim()) {
        formData.append("name", name.trim());
    }

    return request("/analyze", {
        method: "POST",
        body: formData,
    });
}

// ---------- Background job tracking ----------

/**
 * Get the current state of an analysis job.
 *
 * `since` requests only log entries after this index.
 */
export async function getJob(jobId, since = 0) {
    if (!jobId) {
        throw new Error("A job ID is required.");
    }

    const query = new URLSearchParams({
        since: String(Math.max(0, Number(since) || 0)),
    });

    return request(`/jobs/${encodeURIComponent(jobId)}?${query}`);
}

// ---------- Report history ----------

/**
 * Retrieve the list of saved analysis reports.
 */
export async function getReports() {
    return request("/reports");
}

/**
 * Retrieve one complete saved report.
 */
export async function getReport(reportId) {
    if (!reportId) {
        throw new Error("A report ID is required.");
    }

    return request(`/reports/${encodeURIComponent(reportId)}`);
}

/**
 * Delete a saved report.
 */
export async function deleteReport(reportId) {
    if (!reportId) {
        throw new Error("A report ID is required.");
    }

    return request(`/reports/${encodeURIComponent(reportId)}`, {
        method: "DELETE",
    });
}

// ---------- Report exports ----------

/**
 * Build the URL for a report export.
 */
export function getExportUrl(reportId, format = "csv") {
    if (!reportId) {
        throw new Error("A report ID is required.");
    }

    const encodedId = encodeURIComponent(reportId);

    if (format === "csv") {
        return `${API_BASE}/reports/${encodedId}/csv`;
    }

    if (format === "html") {
        return `${API_BASE}/reports/${encodedId}/report.html`;
    }

    if (format === "json") {
        return `${API_BASE}/reports/${encodedId}`;
    }

    throw new Error(`Unsupported export format: ${format}`);
}

/**
 * Open a report export in the browser.
 */
export function openExport(reportId, format = "csv") {
    const url = getExportUrl(reportId, format);
    window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Download a report export.
 */
export function downloadExport(reportId, format = "csv") {
    const url = getExportUrl(reportId, format);

    const link = document.createElement("a");
    link.href = url;

    if (format !== "html") {
        link.download = "";
    }

    document.body.appendChild(link);
    link.click();
    link.remove();
}
