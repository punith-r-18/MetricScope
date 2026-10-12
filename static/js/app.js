
/**
 * MetricScope application controller.
 * Navigation, theme, health, settings, uploads and job progress.
 */

import {
    getHealth,
    getSettings,
    saveSettings,
    startAnalysis,
    getJob,
    getReports,
    getReport,
    deleteReport,
    downloadExport,
} from "./api.js";

import {
    $,
    $$,
    getPreferredTheme,
    applyTheme,
    toggleTheme,
    showToast,
    setText,
    setVisible,
    formatDate,
    formatDuration,
    formatNumber,
    setButtonLoading,
    copyToClipboard,
} from "./ui.js";

import { renderComparisonCharts, destroyComparisonCharts } from "./charts.js";
import { exportCSV, exportHTML } from "./report.js";

// ---------- Application state ----------

const state = {
    inputMode: "upload",
    selectedFile: null,
    health: null,
    currentJobId: null,
    logCount: 0,
    pollTimer: null,
    elapsedTimer: null,
    jobStartedAt: null,
    lastError: "",
};

// ---------- General helpers ----------

function showMessage(message, type = "error") {
    const element = $("#analyze-message");

    if (!element) return;

    element.textContent = message;
    element.className = `form-message ${type}`;
    element.hidden = false;
}

function clearMessage() {
    const element = $("#analyze-message");

    if (element) {
        element.textContent = "";
        element.className = "form-message hidden";
        element.hidden = true;
    }
}

function setPill(id, online, title) {
    const pill = $(`#${id}`);

    if (!pill) return;

    const dot = $(".status-dot", pill);

    if (dot) {
        dot.classList.toggle("online", Boolean(online));
        dot.classList.toggle("offline", !online);
    }

    pill.classList.toggle("is-online", Boolean(online));
    pill.classList.toggle("is-offline", !online);

    if (title) pill.title = title;
}

function setAnalyzeEnabled() {
    const button = $("#analyze-button");
    if (!button) return;

    const inputValid = state.inputMode === "upload"
        ? Boolean(state.selectedFile)
        : Boolean($("#folder-path")?.value.trim());

    const healthReady = Boolean(
        state.health?.sonar_reachable &&
        state.health?.scanner_found &&
        state.health?.cloc_found &&
        state.health?.lizard_found
    );

    button.disabled = !inputValid || !healthReady;
}

// ---------- Navigation ----------


function navigate(viewName) {
    const validViews = ["analyze", "history", "project-comparison", "how", "results"];

    if (!validViews.includes(viewName)) return;

    $$(".view").forEach((view) => {
        const active = view.dataset.view === viewName;
        view.classList.toggle("active", active);
        view.hidden = !active;
    });

    $$("[data-view-link]").forEach((link) => {
        link.classList.toggle(
            "active",
            link.dataset.viewLink === viewName
        );
    });
        if (viewName === "history") {
        loadHistory();
    }

    if (viewName === "project-comparison") {
        loadProjectComparisonProjects();
    }
}

// ---------- Theme ----------

function initializeTheme() {
    applyTheme(getPreferredTheme());

    $("#theme-toggle")?.addEventListener("click", () => {
        toggleTheme();
    });
}

// ---------- Health status ----------

function renderHealth(health) {
    state.health = health;

    const sonarOnline = health.sonar_reachable &&
        health.sonar_status === "UP";

    setPill(
        "status-sonar",
        sonarOnline,
        sonarOnline ? "SonarQube is UP" : "SonarQube is unavailable"
    );

    setPill(
        "status-scanner",
        health.scanner_found,
        health.scanner_found ? "SonarScanner found" : "SonarScanner not found"
    );

    setPill(
        "status-cloc",
        health.cloc_found,
        health.cloc_found ? "cloc found" : "cloc not found"
    );

    const message = $("#analyze-message");

    if (!sonarOnline) {
        showMessage(
            "SonarQube is not reachable. Check that Docker Compose is running and SonarQube is UP."
        );
    } else if (!health.scanner_found) {
        showMessage("SonarScanner was not found. Check its installation and PATH.");
    } else if (!health.cloc_found) {
        showMessage("cloc was not found. Check its installation and PATH.");
    } else if (!health.lizard_found) {
        showMessage("Lizard is not available in the Python environment.");
    } else if (message?.textContent.includes("not") || message?.textContent.includes("SonarQube")) {
        clearMessage();
    }

    setAnalyzeEnabled();
}

async function refreshHealth() {
    try {
        const health = await getHealth();
        renderHealth(health);
    } catch (error) {
        state.health = null;

        setPill("status-sonar", false, "Backend unavailable");
        setPill("status-scanner", false, "Status unavailable");
        setPill("status-cloc", false, "Status unavailable");

        showMessage(error.message);
        setAnalyzeEnabled();
    }
}

// ---------- Input mode ----------

function setInputMode(mode) {
    state.inputMode = mode;

    const uploadMode = mode === "upload";

    $("#mode-upload")?.classList.toggle("active", uploadMode);
    $("#mode-folder")?.classList.toggle("active", !uploadMode);

    setVisible("#upload-panel", uploadMode);
    setVisible("#folder-panel", !uploadMode);

    clearMessage();
    setAnalyzeEnabled();
}

function initializeInputMode() {
    $("#mode-upload")?.addEventListener("click", () => {
        setInputMode("upload");
    });

    $("#mode-folder")?.addEventListener("click", () => {
        setInputMode("folder");
    });

    $("#folder-path")?.addEventListener("input", () => {
        clearMessage();
        setAnalyzeEnabled();
    });
}

// ---------- ZIP upload ----------

function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function selectFile(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".zip")) {
        showMessage("Please select a ZIP file.");
        return;
    }

    const maxSize = 500 * 1024 * 1024;

    if (file.size > maxSize) {
        showMessage("The ZIP file exceeds the 500 MB limit.");
        return;
    }

    state.selectedFile = file;

    setText("#selected-file-name", file.name);
    setText("#selected-file-size", formatFileSize(file.size));

    setVisible("#selected-file", true);
    setVisible("#drop-zone", false);

    clearMessage();
    setAnalyzeEnabled();
}

function removeFile() {
    state.selectedFile = null;

    const input = $("#project-zip");
    if (input) input.value = "";

    setVisible("#selected-file", false);
    setVisible("#drop-zone", true);

    setAnalyzeEnabled();
}

function initializeUpload() {
    const input = $("#project-zip");
    const dropZone = $("#drop-zone");

    input?.addEventListener("change", () => {
        console.log("ZIP INPUT CHANGE EVENT FIRED");
        console.log("Selected file:", input.files?.[0]);
        selectFile(input.files?.[0]);
    });

    dropZone?.addEventListener("click", () => {
        input?.click();
    });

    dropZone?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            input?.click();
        }
    });

    ["dragenter", "dragover"].forEach((eventName) => {
        dropZone?.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropZone.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach((eventName) => {
        dropZone?.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropZone.classList.remove("dragover");
        });
    });

    dropZone?.addEventListener("drop", (event) => {
        const file = event.dataTransfer?.files?.[0];
        selectFile(file);
    });

    $("#remove-file")?.addEventListener("click", removeFile);
}

// ---------- Settings modal ----------

function openSettings() {
    setVisible("#settings-modal", true);
    loadSettings();
}

function closeSettings() {
    setVisible("#settings-modal", false);
}

async function loadSettings() {
    try {
        const settings = await getSettings();

        setText("#token-status", settings.token_set
            ? "A token is saved. Enter a new token only if you want to replace it."
            : "No token is currently saved.");

        if ($("#settings-host")) {
            $("#settings-host").value = settings.host || "";
        }

        if ($("#settings-scanner")) {
            $("#settings-scanner").value = settings.scanner || "sonar-scanner";
        }

        if ($("#settings-token")) {
            $("#settings-token").value = "";
        }
    } catch (error) {
        showToast(error.message, "error");
    }
}

function initializeSettings() {
    $("#settings-open")?.addEventListener("click", openSettings);
    $("#settings-close")?.addEventListener("click", closeSettings);
    $("#settings-cancel")?.addEventListener("click", closeSettings);

    $("#settings-modal")?.addEventListener("click", (event) => {
        if (event.target.id === "settings-modal") {
            closeSettings();
        }
    });

    $("#toggle-token")?.addEventListener("click", () => {
        const tokenInput = $("#settings-token");
        if (!tokenInput) return;

        const show = tokenInput.type === "password";
        tokenInput.type = show ? "text" : "password";
        setText("#toggle-token", show ? "Hide" : "Show");
    });

    $("#settings-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();

        const button = $("#settings-save");

        try {
            setButtonLoading(button, true, "Saving...");

            await saveSettings({
                host: $("#settings-host")?.value.trim() || "",
                token: $("#settings-token")?.value || "",
                scanner: $("#settings-scanner")?.value.trim() || "sonar-scanner",
            });

            closeSettings();
            showToast("Settings saved successfully.", "success");

            await refreshHealth();
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setButtonLoading(button, false);
        }
    });

    $("#test-connection")?.addEventListener("click", async () => {
        const button = $("#test-connection");
        const status = $("#settings-test-status");

        setButtonLoading(button, true, "Testing...");
        setText("#settings-test-status", "Checking connection...");

        try {
            const health = await getHealth();

            const checks = [
                ["SonarQube", health.sonar_reachable && health.sonar_status === "UP"],
                ["Token", health.token_valid],
                ["SonarScanner", health.scanner_found],
                ["cloc", health.cloc_found],
                ["Lizard", health.lizard_found],
            ];

            const container = $("#settings-checks");
            if (container) {
                container.replaceChildren();

                checks.forEach(([label, passed]) => {
                    const row = document.createElement("div");
                    row.className = `settings-check ${passed ? "success" : "error"}`;

                    const name = document.createElement("span");
                    name.textContent = label;

                    const result = document.createElement("strong");
                    result.textContent = passed ? "✓ Available" : "✗ Unavailable";

                    row.append(name, result);
                    container.appendChild(row);
                });

                container.hidden = false;
                container.classList.remove("hidden");
            }

            const allPassed = checks.every(([, passed]) => passed);

            setText(
                "#settings-test-status",
                allPassed ? "All checks passed." : "Some checks need attention."
            );

            showToast(
                allPassed ? "All connection checks passed." : "Some connection checks failed.",
                allPassed ? "success" : "warning"
            );
        } catch (error) {
            setText("#settings-test-status", error.message);
            showToast(error.message, "error");
        } finally {
            setButtonLoading(button, false);
        }
    });
}

// ---------- Analysis progress ----------

function showProgress() {
    setVisible("#analyze-card", false);
    setVisible("#progress-card", true);
    setVisible("#analysis-error", false);

    const logs = $("#live-logs");
    if (logs) {
        logs.replaceChildren();
    }

    state.logCount = 0;
    setText("#progress-status", "Starting analysis...");
    setText("#progress-title", "Analyzing your project");
    setText("#progress-subtitle", "Preparing your source code...");
    updateStepper(0);
}

function hideProgress() {
    setVisible("#progress-card", false);
    setVisible("#analyze-card", true);
}

function updateStepper(step) {
    const currentStep = Math.max(0, Number(step) || 0);

    $$(".step-item").forEach((item) => {
        const index = Number(item.dataset.step);
        const indicator = $(".step-indicator", item);

        item.classList.toggle("completed", index < currentStep);
        item.classList.toggle("active", index === currentStep);

        if (indicator) {
            indicator.textContent = index < currentStep
                ? "✓"
                : String(index + 1);
        }
    });

    $$(".step-connector").forEach((connector, index) => {
        connector.classList.toggle("completed", index < currentStep);
    });
}

function appendLogs(logs) {
    const container = $("#live-logs");
    if (!container || !Array.isArray(logs)) return;

    logs.forEach((line) => {
        const entry = document.createElement("div");
        entry.className = "log-line";
        entry.textContent = String(line);
        container.appendChild(entry);
    });

    container.scrollTop = container.scrollHeight;
}

function startElapsedTimer() {
    state.jobStartedAt = Date.now();

    clearInterval(state.elapsedTimer);

    state.elapsedTimer = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - state.jobStartedAt) / 1000);
        const minutes = Math.floor(seconds / 60);
        const remaining = seconds % 60;

        setText(
            "#elapsed-time",
            `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
        );
    }, 1000);
}

function stopTimers() {
    clearInterval(state.pollTimer);
    clearInterval(state.elapsedTimer);

    state.pollTimer = null;
    state.elapsedTimer = null;
}

async function pollJob() {
    if (!state.currentJobId) return;

    try {
        const job = await getJob(state.currentJobId, state.logCount);

        if (Array.isArray(job.logs)) {
            appendLogs(job.logs);
            state.logCount += job.logs.length;
        }

        if (Number.isFinite(Number(job.step))) {
            updateStepper(job.step);
        }

        setText("#progress-status", job.status || "Running...");

        if (job.status === "done" || job.status === "completed") {
            stopTimers();
            updateStepper(5);
            setText("#progress-title", "Analysis completed");
            setText("#progress-subtitle", "Your project metrics are ready.");

            showToast("Project analysis completed successfully.", "success");

            if (job.result?.id) {
                navigate("results");
                renderBasicResult(job.result);
            } else {
                navigate("history");
            }

            state.currentJobId = null;
        } else if (job.status === "error" || job.status === "failed") {
            throw new Error(job.error || "Analysis failed.");
        }
    } catch (error) {
        stopTimers();
        state.lastError = error.message;

        setVisible("#progress-card", false);
        setVisible("#analysis-error", true);
        setText("#analysis-error-message", error.message);

        showToast("Analysis could not be completed.", "error");
        state.currentJobId = null;
    }
}

// Temporary completion view; full results dashboard arrives in Stage 3.

function renderBasicResult(result) {
    const container = $("#results-content");
    if (!container) return;

    destroyComparisonCharts();
    container.replaceChildren();

    const escapeHTML = (value) =>
        String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        })[char]);

    const displayValue = (value) => {
        if (value === null || value === undefined || value === "") {
            return "—";
        }

        const number = Number(value);
        return Number.isFinite(number)
            ? number.toLocaleString("en-IN")
            : escapeHTML(value);
    };

    const comparison = Array.isArray(result.comparison)
        ? result.comparison
        : [];
        const insights = Array.isArray(result.insights)
    ? result.insights
    : [];

const insightCards = insights.map((insight) => {
    const level = {
        info: "info",
        warn: "warning",
        good: "success",
    }[insight.level] || "info";

    return `
        <article class="insight-card insight-level ${level}">
            <div class="insight-card-header">
                <span class="insight-badge">${level.toUpperCase()}</span>
                <h3 class="insight-title">${escapeHTML(insight.title)}</h3>
            </div>
            <p>${escapeHTML(insight.text)}</p>
        </article>
    `;
}).join("");

    const totals = result.totals || {};
    
    const sonarMetrics = result.sonar_raw || {};

    const qualityMetricDefinitions = [
    {
        label: "Bugs",
        key: "bugs",
        type: "count",
    },
    {
        label: "Vulnerabilities",
        key: "vulnerabilities",
        type: "count",
    },
    {
        label: "Code smells",
        key: "code_smells",
        type: "count",
    },
    {
        label: "Duplication",
        key: "duplicated_lines_density",
        type: "percentage",
    },
    {
        label: "Technical debt",
        key: "sqale_index",
        type: "debt",
    },
    {
        label: "Cognitive complexity",
        key: "cognitive_complexity",
        type: "count",
    },
];

    const qualityMetrics = qualityMetricDefinitions.map((metric) => ({
        ...metric,
        value: sonarMetrics[metric.key] ?? null,
   }));
   const languageRows = Object.entries(result.cloc_by_language || {})
    .map(([language, values]) => ({
        language,
        code: values?.code ?? 0,
        blank: values?.blank ?? 0,
        comment: values?.comment ?? 0,
        files: values?.nFiles ?? 0,
    }))
    .sort((a, b) => Number(b.code) - Number(a.code));

        const metricDefinitions = [
        {
            label: "Files",
            metric: "Files",
        },
        {
            label: "Total lines",
            metric: "Total lines",
        },
        {
            label: "Code lines (NCLOC)",
            metric: "Code lines (LOC/NCLOC)",
        },
        {
            label: "Comment lines",
            metric: "Comment lines",
        },
        {
            label: "Functions",
            metric: "Functions",
        },
        {
            label: "Complexity",
            metric: "Cyclomatic complexity",
        },
    ];

    const metricCards = metricDefinitions.map((definition) => {
        const row = comparison.find(
            (item) => item.Metric === definition.metric
        );

        return {
            label: definition.label,
            sonar: row?.SonarQube,
            cloc: row?.["cloc (Sonar languages)"],
            lizard: row?.Lizard,
            clocDiff: row?.["Diff % cloc vs Sonar"],
            lizardDiff: row?.["Diff % Lizard vs Sonar"],
        };
    });

    const getDeltaClass = (value) => {
        if (value === null || value === undefined) return "neutral";

        const difference = Math.abs(Number(value));

        if (!Number.isFinite(difference)) return "neutral";
        if (difference <= 5) return "good";
        if (difference <= 15) return "warning";

        return "danger";
    };

    const renderDelta = (value) => {
        if (value === null || value === undefined) {
            return "—";
        }

        const number = Number(value);

        if (!Number.isFinite(number)) return "—";

        return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
    };

    const metricRows = comparison.map((row) => `
        <tr>
            <td>${escapeHTML(row.Metric)}</td>
            <td>${displayValue(row.SonarQube)}</td>
            <td>${displayValue(row["cloc (all files)"])}</td>
            <td>${displayValue(row["cloc (Sonar languages)"])}</td>
            <td>${displayValue(row.Lizard)}</td>
            <td>
                <span class="results-delta ${getDeltaClass(row["Diff % cloc vs Sonar"])}">
                    ${renderDelta(row["Diff % cloc vs Sonar"])}
                </span>
            </td>
            <td>
                <span class="results-delta ${getDeltaClass(row["Diff % Lizard vs Sonar"])}">
                    ${renderDelta(row["Diff % Lizard vs Sonar"])}
                </span>
            </td>
        </tr>
    `).join("");

    const timestamp = result.timestamp
        ? formatDate(result.timestamp)
        : "Date unavailable";

    container.innerHTML = `
        <div class="results-dashboard">

            <header class="results-header">
                <div class="results-heading">
                    <span class="section-kicker">ANALYSIS RESULTS</span>
                    <h1>${escapeHTML(result.project || "Project analysis")}</h1>
                    <p>Your software metrics comparison is ready.</p>

                    <div class="results-meta">
                        <span>◷ ${escapeHTML(timestamp)}</span>
                        <span>◴ ${escapeHTML(formatDuration(result.duration_seconds))}</span>
                        <span>Project key: ${escapeHTML(result.sonar_key || "—")}</span>
                    </div>
                </div>

                <div class="results-actions">
                    <button class="button button-secondary" id="export-csv" type="button">
                        Export CSV
                    </button>
                    <button class="button button-secondary" id="export-html" type="button">
                        Export HTML
                    </button>
                    <button class="button button-secondary" id="results-history" type="button">
                        View history
                    </button>
                    <button class="button button-primary" id="results-new-analysis" type="button">
                        + New analysis
                    </button>
                </div>
            </header>

            <section class="results-kpi-grid" aria-label="Key metrics">
                                ${metricCards.map((card) => `
                    <article class="results-kpi">
                        <div class="results-kpi-label">${escapeHTML(card.label)}</div>

                        <div class="results-kpi-value">
                            ${displayValue(card.sonar)}
                        </div>

                        <div class="results-kpi-tool">
                            <span class="results-kpi-indicator tool-sonar"></span>
                            SonarQube
                        </div>

                        <div class="results-kpi-comparisons">
                            <div class="results-kpi-chip">
                                <span class="results-kpi-chip-label">cloc</span>
                                <strong>${displayValue(card.cloc)}</strong>
                                <span class="results-kpi-delta ${getDeltaClass(card.clocDiff)}">
                                    ${renderDelta(card.clocDiff)}
                                </span>
                            </div>

                            <div class="results-kpi-chip">
                                <span class="results-kpi-chip-label">Lizard</span>
                                <strong>${displayValue(card.lizard)}</strong>
                                <span class="results-kpi-delta ${getDeltaClass(card.lizardDiff)}">
                                    ${renderDelta(card.lizardDiff)}
                                </span>
                            </div>
                        </div>
                    </article>
                `).join("")}
            </section>

                        <div class="results-chart-grid">

                <section class="results-panel">
                    <div class="results-panel-header">
                        <div>
                            <h2>Lines comparison</h2>
                            <p>Total lines, code lines and comment lines across tools.</p>
                        </div>
                    </div>

                    <div class="results-chart-wrap">
                        <canvas id="lines-comparison-chart"
                            role="img"
                            aria-label="Grouped bar chart comparing total, code and comment lines">
                        </canvas>
                    </div>
                </section>

                <section class="results-panel">
                    <div class="results-panel-header">
                        <div>
                            <h2>Structure comparison</h2>
                            <p>Files, functions and cyclomatic complexity.</p>
                        </div>
                    </div>

                    <div class="results-chart-wrap">
                        <canvas id="structure-comparison-chart"
                            role="img"
                            aria-label="Grouped bar chart comparing files, functions and complexity">
                        </canvas>
                    </div>
                </section>

                <section class="results-panel">
                    <div class="results-panel-header">
                        <div>
                            <h2>Language distribution</h2>
                            <p>Distribution of code lines across programming languages.</p>
                        </div>
                    </div>

                    <div class="results-chart-wrap">
                        <canvas id="language-doughnut-chart"
                            role="img"
                            aria-label="Doughnut chart showing code distribution by language">
                        </canvas>
                    </div>
                    
                    <div class="language-table-wrap">
                        <table class="results-table language-table">
                            <thead>
                                <tr>
                                    <th>Language</th>
                                    <th>Code lines</th>
                                    <th>Blank lines</th>
                                    <th>Comment lines</th>
                                    <th>Files</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${languageRows.length > 0
                                    ? languageRows.map((item) => `
                                        <tr>
                                            <td>${escapeHTML(item.language)}</td>
                                            <td>${displayValue(item.code)}</td>
                                            <td>${displayValue(item.blank)}</td>
                                            <td>${displayValue(item.comment)}</td>
                                            <td>${displayValue(item.files)}</td>
                                        </tr>
                                    `).join("")
                                    : `
                                        <tr>
                                            <td colspan="5" class="results-empty">
                                                No language data available.
                                            </td>
                                        </tr>
                                    `
                                }
                            </tbody>
                        </table>
                    </div>

                </section>

                <section class="results-panel">
                    <div class="results-panel-header">
                        <div>
                            <h2>Tool differences</h2>
                            <p>Absolute percentage differences compared with SonarQube.</p>
                        </div>
                    </div>

                    <div class="results-chart-wrap">
                        <canvas id="tool-differences-chart"
                            role="img"
                            aria-label="Horizontal bar chart showing percentage differences between tools">
                        </canvas>
                    </div>
                </section>

                <section class="results-panel">
                    <div class="results-panel-header">
                        <div>
                            <h2>Analysis summary</h2>
                            <p>Overview of this analysis run.</p>
                        </div>
                    </div>

                    <div class="insight-card">
                        <h3>Three tools, one comparison</h3>
                        <p>
                            MetricScope compares SonarQube, cloc and Lizard.
                            Each tool has different metric definitions and
                            language support, so some differences are expected.
                        </p>
                    </div>

                    <div class="insight-card" style="margin-top:12px">
                        <h3>Analysis duration</h3>
                        <p>${escapeHTML(formatDuration(result.duration_seconds))}</p>
                    </div>

                    <div class="insight-card" style="margin-top:12px">
                        <h3>Metrics collected</h3>
                        <p>${comparison.length} comparison metrics are available.</p>
                    </div>
                </section>

            </div>
                    <section class="results-panel">
                <div class="results-panel-header">
                    <div>
                        <h2>Automated insights</h2>
                        <p>Observations generated from your software metrics.</p>
                    </div>
                </div>

                <div class="insights-grid">
                    ${insightCards || `
                        <article class="insight-card">
                            <h3>No insights available</h3>
                            <p>Insights could not be generated for this analysis.</p>
                        </article>
                    `}
                </div>
            </section>

                    <section class="results-panel">
                <div class="results-panel-header">
                    <div>
                        <h2>Quality Metrics</h2>
                        <p>Code quality indicators collected from SonarQube.</p>
                    </div>
                </div>

                
<div class="quality-metrics-grid">
    ${qualityMetrics.map((metric) => {
        const value = Number(metric.value);
        let grade = "NA";
        let score = 0;

        if (metric.value !== null && Number.isFinite(value)) {
            if (metric.key === "bugs" || metric.key === "vulnerabilities") {
                grade = value === 0 ? "A" : value === 1 ? "B" : value <= 5 ? "C" : value <= 10 ? "D" : "E";
            } else if (metric.key === "code_smells") {
                grade = value <= 5 ? "A" : value <= 20 ? "B" : value <= 50 ? "C" : value <= 100 ? "D" : "E";
            } else if (metric.key === "duplicated_lines_density") {
                grade = value <= 3 ? "A" : value <= 5 ? "B" : value <= 10 ? "C" : value <= 20 ? "D" : "E";
            } else if (metric.key === "sqale_index") {
                grade = value <= 30 ? "A" : value <= 120 ? "B" : value <= 480 ? "C" : value <= 1440 ? "D" : "E";
            } else if (metric.key === "cognitive_complexity") {
                grade = value <= 10 ? "A" : value <= 20 ? "B" : value <= 50 ? "C" : value <= 100 ? "D" : "E";
            }

            score = { A: 100, B: 80, C: 60, D: 40, E: 20 }[grade] || 0;
        }

        const gradeClass = grade === "NA" ? "na" : grade.toLowerCase();

        return `
            <article class="quality-metric-card">
                <div class="quality-metric-ring quality-grade-${gradeClass}"
                     style="--quality-score: ${score}%">
                    <span>${grade === "NA" ? "—" : grade}</span>
                </div>
                <div class="quality-metric-info">
                    <span class="quality-metric-label">
                        ${escapeHTML(metric.label)}
                    </span>
                    <strong class="quality-metric-value">
                        ${metric.value === null ? "—" : displayValue(metric.value)}
                    </strong>
                    <span class="quality-metric-grade quality-grade-${gradeClass}">
                        ${grade === "NA" ? "NOT AVAILABLE" : `GRADE ${grade}`}
                    </span>
                </div>
            </article>
        `;
    }).join("")}
</div>

            </section>

            <section class="results-panel">
                <div class="results-panel-header">
                    <div>
                        <h2>Detailed comparison</h2>
                        <p>All reported values and percentage differences.</p>
                    </div>
                </div>

                <div class="results-table-wrap">
                    <table class="results-table">
                        <thead>
                            <tr>
                                <th>Metric</th>
                                <th><span class="tool-label sonar">SonarQube</span></th>
                                <th><span class="tool-label cloc">cloc (all)</span></th>
                                <th><span class="tool-label cloc">cloc (aligned)</span></th>
                                <th><span class="tool-label lizard">Lizard</span></th>
                                <th>Diff % cloc</th>
                                <th>Diff % Lizard</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${metricRows || `
                                <tr>
                                    <td colspan="7" class="results-empty">
                                        No comparison data available.
                                    </td>
                                </tr>
                            `}
                        </tbody>
                    </table>
                </div>
            </section>

            <footer class="results-footer">
                <span>Report ID: ${escapeHTML(result.id || "—")}</span>
                <span>MetricScope · Software Metrics Analyzer</span>
            </footer>

        </div>
    `;

    
    $("#results-new-analysis")?.addEventListener("click", () => {
        navigate("analyze");
    });

    $("#results-history")?.addEventListener("click", () => {
        navigate("history");
    });

    $("#export-csv")?.addEventListener("click", () => {
        exportCSV(result.id);
    });

    $("#export-html")?.addEventListener("click", () => {
        exportHTML(result.id);
    });


    if (comparison.length > 0) {
        try {
            renderComparisonCharts(result);
        } catch (error) {
            console.error("Could not render comparison charts:", error);
            showToast("Results loaded, but charts could not be rendered.", "error");
        }
    }
}

function showAnalysisError(message) {
    state.lastError = message;
    hideProgress();

    setVisible("#analysis-error", true);
    setText("#analysis-error-message", message);
}

async function beginAnalysis() {
    clearMessage();

    if (!state.health?.sonar_reachable ||
        !state.health?.scanner_found ||
        !state.health?.cloc_found ||
        !state.health?.lizard_found) {
        showMessage("One or more required tools are unavailable. Check your connection status.");
        return;
    }

    const button = $("#analyze-button");

    try {
        setButtonLoading(button, true, "Starting analysis...");

        const payload = {
            file: state.inputMode === "upload" ? state.selectedFile : null,
            folder: state.inputMode === "folder"
                ? $("#folder-path")?.value.trim() || ""
                : "",
            name: $("#project-name")?.value.trim() || "",
        };

        const response = await startAnalysis(payload);

        if (!response.job_id) {
            throw new Error("The backend did not return a job ID.");
        }

        state.currentJobId = response.job_id;

        showProgress();
        startElapsedTimer();

        await pollJob();

        if (state.currentJobId) {
            state.pollTimer = window.setInterval(pollJob, 1000);
        }
    } catch (error) {
        showMessage(error.message);
    } finally {
        setButtonLoading(button, false);
    }
}

function initializeAnalysis() {
    $("#analyze-button")?.addEventListener("click", beginAnalysis);

    $("#cancel-progress")?.addEventListener("click", () => {
        stopTimers();
        state.currentJobId = null;
        hideProgress();
    });

    $("#retry-analysis")?.addEventListener("click", () => {
        setVisible("#analysis-error", false);
        navigate("analyze");
    });

    $("#copy-error")?.addEventListener("click", () => {
        copyToClipboard(state.lastError);
    });
}

// ---------- History ----------

function createHistoryCard(report) {
    const card = document.createElement("article");
    card.className = "history-card glass-card";

    const header = document.createElement("div");
    header.className = "history-card-header";

    const title = document.createElement("h3");
    title.textContent = report.project || "Untitled project";

    const date = document.createElement("p");
    date.className = "history-date";
    date.textContent = formatDate(report.timestamp);

    header.append(title, date);

    const metrics = document.createElement("div");
    metrics.className = "history-metrics";

    const metricItems = [
        ["SonarQube NCLOC", report.totals?.sonar_ncloc],
        ["cloc code lines", report.totals?.cloc_code],
        ["Lizard NLOC", report.totals?.lizard_nloc],
    ];

    metricItems.forEach(([label, value]) => {
        const item = document.createElement("div");
        item.className = "history-metric";

        const metricLabel = document.createElement("span");
        metricLabel.textContent = label;

        const metricValue = document.createElement("strong");
        metricValue.textContent = formatNumber(value);

        item.append(metricLabel, metricValue);
        metrics.appendChild(item);
    });

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const openButton = document.createElement("button");
    openButton.className = "button button-secondary button-small";
    openButton.textContent = "Open report";

    openButton.addEventListener("click", async () => {
        try {
            const result = await getReport(report.id);
            navigate("results");
            renderBasicResult(result);
        } catch (error) {
            showToast(error.message, "error");
        }
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "button button-danger button-small";
    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", async () => {
        if (!window.confirm("Delete this saved report?")) return;

        try {
            await deleteReport(report.id);
            showToast("Report deleted.", "success");
            await loadHistory();
        } catch (error) {
            showToast(error.message, "error");
        }
    });

    actions.append(openButton, deleteButton);
    card.append(header, metrics, actions);

    return card;
}
async function loadHistory() {
    const container = $("#history-grid");
    if (!container) return;

    try {
        const reports = await getReports();

        container.replaceChildren();

        if (!Array.isArray(reports) || reports.length === 0) {
            const empty = document.createElement("div");
            empty.className = "empty-state glass-card";

            const title = document.createElement("h2");
            title.textContent = "No analyses yet";

            const description = document.createElement("p");
            description.textContent = "Your completed project comparisons will appear here.";

            empty.append(title, description);
            container.appendChild(empty);

            setText("#history-count", "0 saved analyses");
            return;
        }

        reports.forEach((report) => {
            container.appendChild(createHistoryCard(report));
        });

        setText("#history-count", `${reports.length} saved analyses`);
    } catch (error) {
        showToast(error.message, "error");
    }
}

async function loadProjectComparisonProjects() {
    const selectA = $("#comparison-project-a");
    const selectB = $("#comparison-project-b");

    if (!selectA || !selectB) return;

    try {
        const reports = await getReports();

        [selectA, selectB].forEach((select, index) => {
            const selectedValue = select.value;

            select.replaceChildren();

            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = index === 0
                ? "Select first project"
                : "Select second project";

            select.appendChild(placeholder);

            reports.forEach((report) => {
                const option = document.createElement("option");
                option.value = report.id;

                const projectName = report.project || "Unknown project";
                const date = report.timestamp
                    ? formatDate(report.timestamp)
                    : "Date unavailable";

                option.textContent = `${projectName} — ${date}`;
                select.appendChild(option);
            });

            if ([...select.options].some((option) => option.value === selectedValue)) {
                select.value = selectedValue;
            }
        });
    } catch (error) {
        showToast(error.message, "error");
    }
}

// ---------- Global navigation events ----------


function initializeNavigation() {
    $$("[data-view-link]").forEach((element) => {
        element.addEventListener("click", (event) => {
            event.preventDefault();
            navigate(element.dataset.viewLink);
        });
    });

    $("#refresh-history")?.addEventListener("click", loadHistory);

    initializeProjectComparison();
}

function initializeProjectComparison() {
    $("#compare-projects-button")?.addEventListener("click", async () => {
        const selectA = $("#comparison-project-a");
        const selectB = $("#comparison-project-b");
        const errorBox = $("#project-comparison-error");
        const resultsContainer = $("#project-comparison-results");
        const compareButton = $("#compare-projects-button");

        errorBox.hidden = true;
        errorBox.textContent = "";
        resultsContainer.replaceChildren();

        const reportIdA = selectA.value;
        const reportIdB = selectB.value;

        if (!reportIdA || !reportIdB) {
            errorBox.textContent = "Please select both projects.";
            errorBox.hidden = false;
            return;
        }

        if (reportIdA === reportIdB) {
            errorBox.textContent = "Please select two different saved analyses.";
            errorBox.hidden = false;
            return;
        }

        setButtonLoading(compareButton, true);

        try {
            const [reportA, reportB] = await Promise.all([
                getReport(reportIdA),
                getReport(reportIdB),
            ]);

            const comparison = compareProjectReports(reportA, reportB);

            renderProjectComparison(reportA, reportB, comparison);

        } catch (error) {
            errorBox.textContent = error.message || "Could not compare the selected projects.";
            errorBox.hidden = false;
        } finally {
            setButtonLoading(compareButton, false);
        }
    });
}

function getProjectMetricGrade(metricKey, rawValue) {
    if (
        rawValue === null ||
        rawValue === undefined ||
        rawValue === ""
    ) {
        return null;
    }

    const value = Number(rawValue);

    if (!Number.isFinite(value) || value < 0) {
        return null;
    }

    if (metricKey === "bugs" || metricKey === "vulnerabilities") {
        return value === 0 ? "A" : value === 1 ? "B" : value <= 5 ? "C" : value <= 10 ? "D" : "E";
    }

    if (metricKey === "code_smells") {
        return value <= 5 ? "A" : value <= 20 ? "B" : value <= 50 ? "C" : value <= 100 ? "D" : "E";
    }

    if (metricKey === "duplicated_lines_density") {
        return value <= 3 ? "A" : value <= 5 ? "B" : value <= 10 ? "C" : value <= 20 ? "D" : "E";
    }

    if (metricKey === "sqale_index") {
        return value <= 30 ? "A" : value <= 120 ? "B" : value <= 480 ? "C" : value <= 1440 ? "D" : "E";
    }

    if (metricKey === "cognitive_complexity") {
        return value <= 10 ? "A" : value <= 20 ? "B" : value <= 50 ? "C" : value <= 100 ? "D" : "E";
    }

    return null;
}

function calculateProjectQualityScore(report, metricDefinitions) {
    const sonarMetrics = report.sonar_raw || {};

    const scores = metricDefinitions
        .map((metric) => {
            const grade = getProjectMetricGrade(
                metric.key,
                sonarMetrics[metric.key]
            );

            if (!grade) return null;

            return {
                key: metric.key,
                score: { A: 100, B: 80, C: 60, D: 40, E: 20 }[grade],
            };
        })
        .filter((item) => item !== null);

    if (scores.length === 0) {
        return {
            score: null,
            available: 0,
        };
    }

    const total = scores.reduce((sum, item) => sum + item.score, 0);

    return {
        score: Math.round(total / scores.length),
        available: scores.length,
    };
}

const projectComparisonMetrics = [
    { label: "Bugs", key: "bugs", unit: "count" },
    { label: "Vulnerabilities", key: "vulnerabilities", unit: "count" },
    { label: "Code smells", key: "code_smells", unit: "count" },
    { label: "Duplication", key: "duplicated_lines_density", unit: "%" },
    { label: "Technical debt", key: "sqale_index", unit: "minutes" },
    { label: "Cognitive complexity", key: "cognitive_complexity", unit: "count" },
];

function compareProjectReports(reportA, reportB) {
    const metricsA = reportA.sonar_raw || {};
    const metricsB = reportB.sonar_raw || {};

    const rows = projectComparisonMetrics.map((metric) => {
        const valueA = metricsA[metric.key];
        const valueB = metricsB[metric.key];

        const gradeA = getProjectMetricGrade(metric.key, valueA);
        const gradeB = getProjectMetricGrade(metric.key, valueB);

        if (!gradeA || !gradeB) {
            return {
                ...metric,
                valueA,
                valueB,
                gradeA,
                gradeB,
                winner: "na",
                comparable: false,
            };
        }

        const scoreA = { A: 100, B: 80, C: 60, D: 40, E: 20 }[gradeA];
        const scoreB = { A: 100, B: 80, C: 60, D: 40, E: 20 }[gradeB];

        return {
            ...metric,
            valueA,
            valueB,
            gradeA,
            gradeB,
            winner: Number(valueA) < Number(valueB) ? "A" : Number(valueB) < Number(valueA) ? "B" : "tie",
            comparable: true,
            scoreA,
            scoreB,
        };
    });

    const comparableRows = rows.filter((row) => row.comparable);

    const scoreA = calculateProjectQualityScore(
        { sonar_raw: Object.fromEntries(comparableRows.map((row) => [row.key, row.valueA])) },
        projectComparisonMetrics.filter((metric) =>
            comparableRows.some((row) => row.key === metric.key)
        )
    );

    const scoreB = calculateProjectQualityScore(
        { sonar_raw: Object.fromEntries(comparableRows.map((row) => [row.key, row.valueB])) },
        projectComparisonMetrics.filter((metric) =>
            comparableRows.some((row) => row.key === metric.key)
        )
    );

    let overallWinner = "tie";

    if (comparableRows.length === 0) {
        overallWinner = "na";
    } else if (scoreA.score > scoreB.score) {
        overallWinner = "A";
    } else if (scoreB.score > scoreA.score) {
        overallWinner = "B";
    }

    return {
        rows,
        scoreA: scoreA.score,
        scoreB: scoreB.score,
        comparableCount: comparableRows.length,
        overallWinner,
    };
}
function renderProjectComparison(reportA, reportB, comparison) {
    const resultsContainer = $("#project-comparison-results");

    const projectNameA = reportA.project || "Project A";
    const projectNameB = reportB.project || "Project B";

    const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[char]);

    const formatMetricValue = (row, value) => {
        if (value === null || value === undefined || value === "") {
            return "Not available";
        }

        const number = Number(value);

        if (!Number.isFinite(number)) {
            return "Not available";
        }

        const formatted = number.toLocaleString("en-IN", {
            maximumFractionDigits: 2,
        });

        if (row.key === "duplicated_lines_density") {
            return `${formatted}%`;
        }

        if (row.key === "sqale_index") {
            return `${formatted} min`;
        }

        return formatted;
    };

    const winnerLabel = (winner) => {
        if (winner === "A") return "Project A better";
        if (winner === "B") return "Project B better";
        if (winner === "tie") return "Tie";
        return "Not comparable";
    };

    const winnerClass = (winner) => {
        if (winner === "A") return "comparison-winner-a";
        if (winner === "B") return "comparison-winner-b";
        if (winner === "tie") return "comparison-winner-tie";
        return "comparison-winner-na";
    };

    const scoreDisplay = (score) => (
        score === null ? "N/A" : `${score}<span>/100</span>`
    );

    let verdict = "Not enough comparable quality data to determine an overall winner.";

    if (comparison.overallWinner === "A") {
        verdict = `${escapeHTML(projectNameA)} has the stronger overall quality score.`;
    } else if (comparison.overallWinner === "B") {
        verdict = `${escapeHTML(projectNameB)} has the stronger overall quality score.`;
    } else if (comparison.overallWinner === "tie") {
        verdict = "Both projects have the same overall quality score.";
    }

    const metricRows = comparison.rows.map((row) => `
        <tr>
            <td>${escapeHTML(row.label)}</td>
            <td>
                ${escapeHTML(formatMetricValue(row, row.valueA))}
                ${row.gradeA ? `<span class="comparison-grade">Grade ${escapeHTML(row.gradeA)}</span>` : ""}
            </td>
            <td>
                ${escapeHTML(formatMetricValue(row, row.valueB))}
                ${row.gradeB ? `<span class="comparison-grade">Grade ${escapeHTML(row.gradeB)}</span>` : ""}
            </td>
            <td>
                <span class="comparison-winner ${winnerClass(row.winner)}">
                    ${winnerLabel(row.winner)}
                </span>
            </td>
        </tr>
    `).join("");

    resultsContainer.innerHTML = `
        <section class="results-panel project-comparison-summary">
            <div class="results-panel-header">
                <div>
                    <h2>Overall comparison</h2>
                    <p>${escapeHTML(projectNameA)} vs ${escapeHTML(projectNameB)}</p>
                </div>
            </div>

            <div class="project-comparison-scores">
                <div class="project-score-card">
                    <h3>${escapeHTML(projectNameA)}</h3>
                    <div class="project-score-value">${scoreDisplay(comparison.scoreA)}</div>
                    <p>Overall quality score</p>
                </div>

                <div class="project-score-card">
                    <h3>${escapeHTML(projectNameB)}</h3>
                    <div class="project-score-value">${scoreDisplay(comparison.scoreB)}</div>
                    <p>Overall quality score</p>
                </div>
            </div>

            <div class="project-comparison-verdict">
                <strong>${verdict}</strong>
                <p>
                    Based on ${comparison.comparableCount} comparable quality metrics.
                    Scores use MetricScope's custom A–E grading scale, not an official SonarQube score.
                </p>
            </div>
        </section>

        <section class="results-panel">
            <div class="results-panel-header">
                <div>
                    <h2>Metric-by-metric comparison</h2>
                    <p>Lower values are better for the quality metrics shown.</p>
                </div>
            </div>

            <div class="table-wrap">
                <table class="data-table project-comparison-table">
                    <thead>
                        <tr>
                            <th>Metric</th>
                            <th>${escapeHTML(projectNameA)}</th>
                            <th>${escapeHTML(projectNameB)}</th>
                            <th>Result</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${metricRows}
                    </tbody>
                </table>
            </div>
        </section>
    `;

    resultsContainer.scrollIntoView({
        behavior: "smooth",
        block: "start",
    });
}


// ---------- Initialize application ----------

async function initializeApp() {
    initializeTheme();
    initializeNavigation();
    initializeInputMode();
    initializeUpload();
    initializeSettings();
    initializeAnalysis();

    navigate("analyze");

    await refreshHealth();

    // Keep tool status fresh every 15 seconds.
    window.setInterval(refreshHealth, 15000);
}

document.addEventListener("DOMContentLoaded", initializeApp);
