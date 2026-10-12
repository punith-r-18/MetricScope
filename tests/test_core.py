import pathlib
import sys
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from core import _diff, build_comparison, extract_zip, make_key


def test_diff():
    assert _diff(100, 110) == 10.0
    assert _diff(0, 5) is None
    assert _diff(100, None) is None


def test_make_key():
    assert make_key("my project!") == "mc-my-project-"


def test_build_comparison_aligns_languages():
    sonar = {
        "files": 3,
        "lines": 100,
        "ncloc": 70,
        "comment_lines": 10,
        "functions": 8,
        "complexity": 20,
        "ncloc_language_distribution": {"py": 70}
    }

    cloc = {
        "Python": {
            "nFiles": 3, "blank": 20,
            "comment": 10, "code": 70
        },
        "Markdown": {
            "nFiles": 1, "blank": 5,
            "comment": 0, "code": 30
        }
    }

    liz = {
        "files": 3, "nloc": 68,
        "functions": 8, "ccn": 22
    }

    rows = {
        r["Metric"]: r
        for r in build_comparison(sonar, cloc, liz)
    }

    assert rows["Files"]["cloc (all files)"] == 4
    assert rows["Files"]["cloc (Sonar languages)"] == 3

    assert rows["Code lines (LOC/NCLOC)"]["cloc (Sonar languages)"] == 70
    assert rows["Code lines (LOC/NCLOC)"]["Diff % cloc vs Sonar"] == 0.0

    assert rows["Cyclomatic complexity"]["Diff % Lizard vs Sonar"] == 10.0


def test_extract_zip_single_wrapper_folder(tmp_path):
    zip_path = tmp_path / "sample.zip"

    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("sample-project/main.py", "print('Hello')")

    destination = tmp_path / "extracted"

    result = extract_zip(zip_path, destination)

    assert result.is_dir()
    assert (result / "main.py").exists()
    assert (result / "main.py").read_text() == "print('Hello')"
