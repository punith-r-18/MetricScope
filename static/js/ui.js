
/**
 * MetricScope UI utilities
 * Theme management, notifications and DOM helpers.
 */

// ---------- Theme management ----------

const THEME_KEY = "metricscope-theme";

export function getPreferredTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);

    if (savedTheme === "dark" || savedTheme === "light") {
        return savedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
}

export function applyTheme(theme) {
    const selectedTheme = theme === "light" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", selectedTheme);
    localStorage.setItem(THEME_KEY, selectedTheme);

    const themeButton = document.querySelector("#theme-toggle");

    if (themeButton) {
        themeButton.setAttribute(
            "aria-label",
            selectedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"
        );

        themeButton.textContent = selectedTheme === "dark" ? "☀️" : "🌙";
    }

    return selectedTheme;
}

export function toggleTheme() {
    const currentTheme =
        document.documentElement.getAttribute("data-theme") || getPreferredTheme();

    return applyTheme(currentTheme === "dark" ? "light" : "dark");
}

// ---------- Toast notifications ----------

let toastContainer = null;

function getToastContainer() {
    if (toastContainer && document.body.contains(toastContainer)) {
        return toastContainer;
    }

    toastContainer = document.querySelector("#toast-container");

    if (!toastContainer) {
        toastContainer = document.createElement("div");
        toastContainer.id = "toast-container";
        toastContainer.className = "toast-container";
        toastContainer.setAttribute("aria-live", "polite");
        toastContainer.setAttribute("aria-atomic", "false");
        document.body.appendChild(toastContainer);
    }

    return toastContainer;
}

export function showToast(message, type = "info", duration = 3500) {
    const container = getToastContainer();

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");

    // textContent prevents user-provided text from being interpreted as HTML.
    toast.textContent = String(message);

    container.appendChild(toast);

    window.setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";

        window.setTimeout(() => {
            toast.remove();
        }, 200);
    }, duration);
}

// ---------- DOM helpers ----------

export function $(selector, parent = document) {
    return parent.querySelector(selector);
}

export function $$(selector, parent = document) {
    return Array.from(parent.querySelectorAll(selector));
}

export function setText(selector, value, parent = document) {
    const element = $(selector, parent);

    if (element) {
        element.textContent = value ?? "";
    }

    return element;
}

export function setVisible(elementOrSelector, visible) {
    const element =
        typeof elementOrSelector === "string"
            ? $(elementOrSelector)
            : elementOrSelector;

    if (!element) return;

    element.hidden = !visible;
    element.classList.toggle("hidden", !visible);
}

export function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString();
}

export function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));

    if (total < 60) {
        return `${total}s`;
    }

    const minutes = Math.floor(total / 60);
    const remainingSeconds = total % 60;

    return `${minutes}m ${remainingSeconds}s`;
}

export function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "—";
    }

    return new Intl.NumberFormat().format(number);
}

// ---------- Button loading state ----------

export function setButtonLoading(button, loading, loadingText = "Please wait...") {
    if (!button) return;

    if (loading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent.trim();
        }

        button.disabled = true;
        button.textContent = loadingText;
    } else {
        button.disabled = false;

        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText;
        }
    }
}

// ---------- Clipboard helper ----------

export async function copyToClipboard(value) {
    try {
        await navigator.clipboard.writeText(String(value));
        showToast("Copied to clipboard.", "success");
        return true;
    } catch (error) {
        showToast("Could not copy to clipboard.", "error");
        return false;
    }
}
