import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from insights import generate_insights


def sample_result():
    return {
        "comparison": [
            {
                "Metric": "Code lines (LOC/NCLOC)",
                "SonarQube": 1000,
                "cloc (all files)": 1200,
                "cloc (Sonar languages)": 1100,
                "Lizard": 950,
                "Diff % cloc vs Sonar": 10.0,
                "Diff % Lizard vs Sonar": -5.0
            },
            {
                "Metric": "Cyclomatic complexity",
                "SonarQube": 100,
                "cloc (all files)": None,
                "cloc (Sonar languages)": None,
                "Lizard": 150,
                "Diff % cloc vs Sonar": None,
                "Diff % Lizard vs Sonar": 50.0
            }
        ],
        "sonar_raw": {
            "ncloc": 1000,
            "comment_lines": 100,
            "functions": 50,
            "complexity": 100,
            "ncloc_language_distribution": {"py": 1000}
        },
        "cloc_by_language": {
            "Python": {
                "nFiles": 10,
                "blank": 100,
                "comment": 100,
                "code": 1100
            },
            "Markdown": {
                "nFiles": 2,
                "blank": 20,
                "comment": 10,
                "code": 100
            }
        },
        "lizard": {
            "files": 10,
            "nloc": 950,
            "functions": 55,
            "ccn": 150
        }
    }


def test_generate_insights_returns_list():
    result = generate_insights(sample_result())

    assert isinstance(result, list)
    assert len(result) > 0


def test_generate_insights_contains_text():
    result = generate_insights(sample_result())

    assert all(isinstance(item, dict) for item in result)

    for item in result:
        assert "level" in item
        assert "title" in item
        assert "text" in item
        assert item["level"] in ("info", "good", "warning")
        assert isinstance(item["title"], str)
        assert isinstance(item["text"], str)
        assert item["title"].strip()
        assert item["text"].strip()