
/**
 * MetricScope - Report export utilities
 */

import { showToast } from "./ui.js";

/**
 * Download a report using the browser.
 */
function downloadFile(url, filename) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

/**
 * Export a report as CSV.
 */
export function exportCSV(reportId) {
    if (!reportId) {
        showToast("Report ID is missing.", "error");
        return;
    }

    downloadFile(
        `/api/reports/${encodeURIComponent(reportId)}/csv`,
        `metricscope-${reportId}.csv`
    );

    showToast("CSV export started.", "success");
}

/**
 * Export a report as HTML.
 */
export function exportHTML(reportId) {
    if (!reportId) {
        showToast("Report ID is missing.", "error");
        return;
    }

    downloadFile(
        `/api/reports/${encodeURIComponent(reportId)}/report.html`,
        `metricscope-${reportId}.html`
    );

    showToast("HTML report export started.", "success");
}
