/**
 * MetricScope - Interactive comparison charts
 * Uses Chart.js 4.4.3
 */

const chartInstances = new Map();

const TOOL_COLORS = {
    sonar: "#9B83FF",
    cloc: "#3DD6F5",
    lizard: "#FBBF24"
};

const LANGUAGE_COLORS = [
    "#9B83FF",
    "#3DD6F5",
    "#FBBF24",
    "#34D399",
    "#F472B6",
    "#60A5FA",
    "#FB923C",
    "#A78BFA",
    "#2DD4BF",
    "#F87171"
];

function getChartColors() {
    const styles = getComputedStyle(document.documentElement);

    return {
        text: styles.getPropertyValue("--text").trim() || "#F3F4F8",
        muted: styles.getPropertyValue("--muted").trim() || "#9AA0B4",
        border: styles.getPropertyValue("--border").trim() || "rgba(255,255,255,0.08)"
    };
}

function getNumericValue(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

function destroyChart(canvasId) {
    const chart = chartInstances.get(canvasId);

    if (chart) {
        chart.destroy();
        chartInstances.delete(canvasId);
    }
}

function createComparisonChart(canvasId, labels, datasets, options = {}) {
    const canvas = document.getElementById(canvasId);

    if (!canvas || typeof Chart === "undefined") {
        console.warn(`Cannot create chart: ${canvasId}`);
        return null;
    }

    destroyChart(canvasId);

    const colors = getChartColors();
    const chartType = options.type || "bar";

    const chart = new Chart(canvas, {
        type: chartType,

        data: {
            labels,
            datasets: datasets.map((dataset) => ({
                ...dataset,
                borderRadius: chartType === "bar" ? 6 : undefined,
                borderSkipped: chartType === "bar" ? false : undefined,
                maxBarThickness: 48
            }))
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 700
            },

            indexAxis: options.indexAxis || "x",

            interaction: {
                intersect: false,
                mode: "index"
            },

            plugins: {
                legend: {
                    display: options.showLegend !== false,
                    position: "bottom",
                    labels: {
                        color: colors.text,
                        usePointStyle: true,
                        padding: 20
                    }
                },

                tooltip: {
                    enabled: true
                }
            },

            scales: chartType === "doughnut" ? {} : {
                x: {
                    beginAtZero: options.indexAxis === "y",
                    ticks: {
                        color: colors.muted
                    },
                    grid: {
                        display: options.indexAxis !== "y",
                        color: colors.border
                    }
                },

                y: {
                    beginAtZero: true,
                    ticks: {
                        color: colors.muted
                    },
                    grid: {
                        color: colors.border
                    }
                }
            }
        }
    });

    chartInstances.set(canvasId, chart);

    return chart;
}

/**
 * Render comparison charts from a MetricScope report.
 */
export function renderComparisonCharts(result) {
    if (!result || !Array.isArray(result.comparison)) {
        console.warn("Invalid MetricScope comparison report.");
        return;
    }

    const rows = result.comparison;

    /**
     * Chart 1: Lines comparison
     */
    const lineMetrics = [
        "Total lines",
        "Code lines (LOC/NCLOC)",
        "Comment lines"
    ];

    const lineRows = lineMetrics.map((metric) =>
        rows.find((row) => row.Metric === metric)
    );

    createComparisonChart(
        "lines-comparison-chart",

        lineMetrics,

        [
            {
                label: "SonarQube",
                data: lineRows.map((row) =>
                    getNumericValue(row?.SonarQube)
                ),
                backgroundColor: TOOL_COLORS.sonar
            },
            {
                label: "cloc",
                data: lineRows.map((row) =>
                    getNumericValue(row?.["cloc (Sonar languages)"])
                ),
                backgroundColor: TOOL_COLORS.cloc
            },
            {
                label: "Lizard",
                data: lineRows.map((row) =>
                    getNumericValue(row?.Lizard)
                ),
                backgroundColor: TOOL_COLORS.lizard
            }
        ]
    );

    /**
     * Chart 2: Structure comparison
     */
    const structureMetrics = [
        "Files",
        "Functions",
        "Cyclomatic complexity"
    ];

    const structureRows = structureMetrics.map((metric) =>
        rows.find((row) => row.Metric === metric)
    );

    createComparisonChart(
        "structure-comparison-chart",

        structureMetrics,

        [
            {
                label: "SonarQube",
                data: structureRows.map((row) =>
                    getNumericValue(row?.SonarQube)
                ),
                backgroundColor: TOOL_COLORS.sonar
            },
            {
                label: "cloc",
                data: structureRows.map((row) =>
                    getNumericValue(row?.["cloc (Sonar languages)"])
                ),
                backgroundColor: TOOL_COLORS.cloc
            },
            {
                label: "Lizard",
                data: structureRows.map((row) =>
                    getNumericValue(row?.Lizard)
                ),
                backgroundColor: TOOL_COLORS.lizard
            }
        ]
    );

    /**
     * Chart 3: Language distribution
     */
    const languageData = result.cloc_by_language || {};

    const languageEntries = Object.entries(languageData)
        .map(([language, values]) => ({
            language,
            code: getNumericValue(values?.code)
        }))
        .filter((item) => item.code !== null && item.code > 0);

    createComparisonChart(
        "language-doughnut-chart",

        languageEntries.map((item) => item.language),

        [
            {
                label: "Code lines",
                data: languageEntries.map((item) => item.code),
                backgroundColor: languageEntries.map(
                    (_, index) =>
                        LANGUAGE_COLORS[index % LANGUAGE_COLORS.length]
                ),
                borderColor: "transparent",
                hoverOffset: 8
            }
        ],

        {
            type: "doughnut"
        }
    );

    /**
     * Chart 4: Percentage differences
     */
    const differenceRows = rows.filter((row) =>
        getNumericValue(row["Diff % cloc vs Sonar"]) !== null ||
        getNumericValue(row["Diff % Lizard vs Sonar"]) !== null
    );

    createComparisonChart(
        "tool-differences-chart",

        differenceRows.map((row) => row.Metric),

        [
            {
                label: "cloc vs SonarQube",
                data: differenceRows.map((row) => {
                    const value = getNumericValue(
                        row["Diff % cloc vs Sonar"]
                    );

                    return value === null ? null : Math.abs(value);
                }),
                backgroundColor: TOOL_COLORS.cloc
            },
            {
                label: "Lizard vs SonarQube",
                data: differenceRows.map((row) => {
                    const value = getNumericValue(
                        row["Diff % Lizard vs Sonar"]
                    );

                    return value === null ? null : Math.abs(value);
                }),
                backgroundColor: TOOL_COLORS.lizard
            }
        ],

        {
            indexAxis: "y"
        }
    );
}

/**
 * Destroy all charts when leaving the results view.
 */
export function destroyComparisonCharts() {
    for (const chartId of chartInstances.keys()) {
        destroyChart(chartId);
    }
}