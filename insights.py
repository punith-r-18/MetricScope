
"""Generate plain-English insights from MetricScope analysis results."""
from __future__ import annotations

from core import CLOC_TO_SONAR


def _number(value, default=0.0) -> float:
    """Convert a value to a number, using a default for missing data."""
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _percent_difference(first, second) -> float | None:
    """Calculate percentage difference relative to the first value."""
    if first is None or second is None:
        return None

    first = _number(first)
    second = _number(second)

    if first == 0:
        return 0.0 if second == 0 else None

    return abs(second - first) / abs(first) * 100


def _format_number(value) -> str:
    """Format a numeric value with thousands separators."""
    return f"{_number(value):,.0f}"


def _format_debt(minutes) -> str:
    """Convert technical debt from minutes into days and hours."""
    total_minutes = max(0, int(_number(minutes)))
    days, remaining = divmod(total_minutes, 1440)
    hours, mins = divmod(remaining, 60)

    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {mins}m"
    return f"{mins}m"


def generate_insights(result: dict) -> list[dict]:
    """
    Generate insights about LOC agreement, language coverage,
    comments, complexity, functions, quality and derived metrics.

    Each insight contains:
    level: info, warn or good
    title: short heading
    text: plain-English explanation
    """
    insights = []

    sonar = result.get("sonar_raw") or {}
    cloc = result.get("cloc_by_language") or {}
    lizard = result.get("lizard") or {}
    comparison = result.get("comparison") or []

    totals = {
        row.get("Metric"): row
        for row in comparison
        if isinstance(row, dict)
    }

    def add(level: str, title: str, text: str) -> None:
        insights.append({
            "level": level,
            "title": title,
            "text": text,
        })

    # ------------------------------------------------ LOC agreement
    sonar_loc = sonar.get("ncloc")
    cloc_loc = totals.get("Code lines (LOC/NCLOC)", {}).get(
        "cloc (Sonar languages)"
    )
    lizard_loc = lizard.get("nloc")

    loc_values = [
        _number(value)
        for value in (sonar_loc, cloc_loc, lizard_loc)
        if value is not None
    ]

    if len(loc_values) == 3:
        reference = max(loc_values)

        if reference == 0:
            spread = 0.0
        else:
            spread = (max(loc_values) - min(loc_values)) / reference * 100

        if spread <= 5:
            add(
                "good",
                "LOC agreement",
                "SonarQube, cloc and Lizard agree closely on the "
                "number of code lines. All three measurements are "
                "within 5% of each other."
            )
        elif spread <= 15:
            add(
                "info",
                "Small LOC differences",
                f"The three tools show a maximum spread of {spread:.2f}%. "
                "This may result from differences in how each tool "
                "counts non-comment lines and source code."
            )
        else:
            add(
                "warn",
                "Significant LOC differences",
                f"The three tools show a maximum spread of {spread:.2f}%. "
                "Check language coverage, file exclusions and each "
                "tool's definition of a line of code."
            )

    else:
        add(
            "info",
            "LOC comparison unavailable",
            "One or more tools did not provide a code-line measurement, "
            "so a complete three-tool comparison could not be made."
        )

    # ---------------------------------------- Unsupported-language gap
    raw_files = _number(
        totals.get("Files", {}).get("cloc (all files)")
    )
    aligned_files = _number(
        totals.get("Files", {}).get("cloc (Sonar languages)")
    )
    raw_code = _number(
        totals.get("Code lines (LOC/NCLOC)", {}).get("cloc (all files)")
    )
    aligned_code = _number(cloc_loc)

    file_gap = (
        (raw_files - aligned_files) / raw_files * 100
        if raw_files > 0 else 0
    )
    code_gap = (
        (raw_code - aligned_code) / raw_code * 100
        if raw_code > 0 else 0
    )

    if file_gap > 10 or code_gap > 10:
        sonar_languages = set(
            (sonar.get("ncloc_language_distribution") or {}).keys()
        )

        unsupported = sorted(
            language
            for language in cloc
            if CLOC_TO_SONAR.get(language) not in sonar_languages
        )

        language_text = (
            ", ".join(unsupported)
            if unsupported
            else "languages outside SonarQube's analysed language set"
        )

        add(
            "warn",
            "Unsupported-language gap",
            f"cloc counted additional files or code outside the "
            f"languages analysed by SonarQube: {language_text}. "
            f"This explains why cloc's all-files total can be higher "
            f"than its Sonar-language-aligned total."
        )

    # ----------------------------------------------- Comment lines
    sonar_comments = sonar.get("comment_lines")
    cloc_comments = totals.get("Comment lines", {}).get(
        "cloc (Sonar languages)"
    )

    comment_difference = _percent_difference(
        sonar_comments, cloc_comments
    )

    if (
        sonar_comments is not None
        and cloc_comments is not None
        and sonar_comments > 0
        and cloc_comments > sonar_comments
        and comment_difference > 20
    ):
        add(
            "info",
            "Comment-line differences",
            f"cloc counted {_format_number(cloc_comments)} comment lines, "
            f"compared with SonarQube's {_format_number(sonar_comments)}. "
            "The difference may come from how the tools classify "
            "commented-out code and handle license headers."
        )

    # ----------------------------------------------- Complexity
    sonar_complexity = sonar.get("complexity")
    lizard_complexity = lizard.get("ccn")

    complexity_difference = _percent_difference(
        sonar_complexity, lizard_complexity
    )

    if sonar_complexity is not None and lizard_complexity is not None:
        add(
            "info",
            "Cyclomatic complexity comparison",
            f"SonarQube reports {_format_number(sonar_complexity)} "
            f"complexity points, while Lizard reports "
            f"{_format_number(lizard_complexity)}. "
            "Their counting rules differ: SonarQube calculates "
            "complexity using language-plugin rules, including "
            "branches and logical operators, while Lizard sums "
            "per-function cyclomatic complexity (CCN)."
            + (
                f" The difference is approximately "
                f"{complexity_difference:.2f}%."
                if complexity_difference is not None else ""
            )
        )

    # --------------------------------------------------- Functions
    sonar_functions = sonar.get("functions")
    lizard_functions = lizard.get("functions")

    function_difference = _percent_difference(
        sonar_functions, lizard_functions
    )

    if sonar_functions is not None and lizard_functions is not None:
        add(
            "info",
            "Function-count comparison",
            f"SonarQube detected {_format_number(sonar_functions)} "
            f"functions, while Lizard detected "
            f"{_format_number(lizard_functions)}. "
            "Differences can occur because tools handle lambdas, "
            "anonymous functions and nested functions differently."
            + (
                f" The difference is approximately "
                f"{function_difference:.2f}%."
                if function_difference is not None else ""
            )
        )

    # ----------------------------------------------- Quality summary
    bugs = _number(sonar.get("bugs"))
    vulnerabilities = _number(sonar.get("vulnerabilities"))
    code_smells = _number(sonar.get("code_smells"))
    duplication = sonar.get("duplicated_lines_density")
    debt = sonar.get("sqale_index")

    quality_parts = [
        f"{_format_number(bugs)} bugs",
        f"{_format_number(vulnerabilities)} vulnerabilities",
        f"{_format_number(code_smells)} code smells",
    ]

    if duplication is not None:
        quality_parts.append(f"{_number(duplication):.2f}% duplication")

    if debt is not None:
        quality_parts.append(f"{_format_debt(debt)} technical debt")

    duplication_value = _number(duplication)
    if duplication is not None and duplication_value > 10:
        quality_level = "warn"
        quality_message = (
            "Code duplication is above 10%. Consider refactoring "
            "repeated code into reusable methods or components."
        )
    elif bugs > 0 or vulnerabilities > 0:
        quality_level = "warn"
        quality_message = (
            "Review the detected bugs and vulnerabilities. "
            "Prioritise security vulnerabilities and functional defects."
        )
    else:
        quality_level = "good"
        quality_message = (
            "No bugs or vulnerabilities were reported by SonarQube. "
            "Continue monitoring code smells, duplication and "
            "technical debt."
        )

    add(
        quality_level,
        "Quality summary",
        "SonarQube reports: "
        + ", ".join(quality_parts)
        + ". "
        + quality_message
    )

    # ---------------------------------------------- Density metrics
    total_code = sum(
        _number(values.get("code"))
        for values in cloc.values()
    )
    total_comments = sum(
        _number(values.get("comment"))
        for values in cloc.values()
    )
    comment_density = (
        total_comments / (total_code + total_comments) * 100
        if total_code + total_comments > 0 else 0
    )

    total_functions = _number(lizard.get("functions"))
    total_nloc = _number(lizard.get("nloc"))
    total_ccn = _number(lizard.get("ccn"))
    lizard_files = _number(lizard.get("files"))

    avg_complexity = (
        total_ccn / total_functions if total_functions > 0 else 0
    )
    avg_loc_file = (
        total_nloc / lizard_files if lizard_files > 0 else 0
    )
    avg_loc_function = (
        total_nloc / total_functions if total_functions > 0 else 0
    )

    add(
        "info",
        "Code density metrics",
        f"Comment density: {comment_density:.2f}%. "
        f"Average complexity per function: {avg_complexity:.2f}. "
        f"Average LOC per file (Lizard): {avg_loc_file:.2f}. "
        f"Average LOC per function (Lizard): {avg_loc_function:.2f}."
    )

    # ----------------------------------------------- Generic note
    add(
        "info",
        "Why tool results differ",
        "Different tools define 'a line of code' differently, "
        "so small differences are expected and not errors."
    )

    return insights
