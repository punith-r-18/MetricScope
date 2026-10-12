# MetricScope

**A Software Metrics Comparison Platform**

MetricScope is a web-based application that analyses software projects using **SonarQube, cloc and Lizard** and compares the metrics produced by these three tools.

It provides a unified comparison of code size, functions, complexity and code quality metrics, helping developers understand how different analysis tools measure the same project.

## Features

- Analyse projects using SonarQube, cloc and Lizard.
- Upload a project as a ZIP file or analyse a local project folder.
- Compare metrics such as files, lines of code, functions and cyclomatic complexity.
- Compare code quality metrics including bugs, vulnerabilities, code smells, duplication and technical debt.
- View KPI cards, comparison tables and charts.
- Generate automated insights from analysis results.
- View saved analysis reports through report history.
- Compare two previously analysed projects.
- View language-wise metrics.
- Export reports in CSV and standalone HTML formats.

## Technology Stack

| Component | Technologies |
|---|---|
| Backend | Python, FastAPI, Uvicorn |
| Frontend | HTML, CSS, JavaScript |
| Software analysis | SonarQube, cloc, Lizard |
| Database for SonarQube | PostgreSQL |
| Containerization | Docker, Docker Compose |
| Python libraries | Requests, python-dotenv, python-multipart |
| Testing | pytest, httpx |

## Prerequisites

Install the following software before running MetricScope:

1. **Python 3.10 or later**
2. **Docker Desktop** with Docker Compose
3. **Java JDK 17 or later**
4. **SonarScanner CLI**
5. **cloc**

Verify the installations:

```powershell
python --version
docker --version
docker compose version
java -version
sonar-scanner --version
cloc --version
```

Make sure SonarScanner CLI and cloc are added to the system PATH.

## Installation and Setup

### 1. Clone or download the project

Open PowerShell and navigate to the project directory:

```powershell
cd path\to\MetricScope
```

### 2. Start SonarQube and PostgreSQL

MetricScope uses Docker Compose to run SonarQube and PostgreSQL.

Start the containers:

```powershell
docker compose up -d
```

Check their status:

```powershell
docker compose ps
```

Wait for SonarQube to finish starting, then open:

http://localhost:9001

Log in using the initial credentials:

- Username: `admin`
- Password: `admin`

Change the password when prompted.

### 3. Generate a SonarQube token

1. Log in to SonarQube.
2. Open your account menu.
3. Select **My Account**.
4. Open the **Security** tab.
5. Generate a new user token.
6. Copy the token and keep it private.

### 4. Set up the Python environment

Create a virtual environment:

```powershell
py -3.11 -m venv venv
```

Activate it:

```powershell
.\venv\Scripts\Activate.ps1
```

Install the dependencies:

```powershell
python -m pip install -r requirements.txt
```

### 5. Configure environment variables

Create your local environment file:

```powershell
Copy-Item .env.example .env
```

Open `.env` and configure:

```env
SONAR_HOST_URL=http://localhost:9001
SONAR_TOKEN=paste_your_token_here
SONAR_SCANNER_PATH=sonar-scanner
```

Replace `paste_your_token_here` with your generated SonarQube token.

**Important:** Never commit your actual `.env` file or expose your SonarQube token publicly.

### 6. Start MetricScope

Run:

```powershell
python run.py
```

Open the application in your browser:

http://127.0.0.1:8000

FastAPI API documentation is available at:

http://127.0.0.1:8000/docs

## How MetricScope Works

MetricScope follows a five-stage analysis process:

1. **SonarScanner:** Scans the project and submits source-code analysis to SonarQube.
2. **SonarQube Processing:** Retrieves the processed metrics through the SonarQube API.
3. **cloc:** Calculates files, blank lines, comment lines and code lines for supported languages.
4. **Lizard:** Analyses source files to calculate NLOC, function count and cyclomatic complexity.
5. **Comparison:** Aligns the metrics, calculates differences and generates a unified report.

The same excluded directories are applied across the analysis tools where supported, helping maintain consistency in the comparison.

## Project Structure

```text
MetricScope/
│
├── core.py                  # Core analysis and comparison logic
├── server.py                # FastAPI application and API endpoints
├── jobs.py                  # Background analysis job management
├── insights.py              # Automated insight generation
├── run.py                   # Application entry point
│
├── static/
│   ├── index.html            # Frontend page
│   ├── css/
│   │   └── styles.css       # Application styling
│   └── js/
│       ├── api.js           # API communication
│       ├── app.js           # Main frontend logic
│       ├── charts.js        # Charts
│       ├── report.js        # Report functionality
│       └── ui.js            # UI functionality
│
├── tests/
│   ├── test_api.py          # API tests
│   ├── test_core.py         # Core logic tests
│   └── test_insights.py     # Insight generation tests
│
├── reports/                 # Saved analysis reports
├── sample_projects/         # Sample projects for analysis
├── docker-compose.yml       # SonarQube and PostgreSQL services
├── requirements.txt         # Python dependencies
├── .env.example             # Environment configuration template
├── .gitignore
└── README.md
```
## Running Tests

Run the automated test suite using:

```powershell
python -m pytest
```

## Troubleshooting

| Problem | Possible solution |
|---|---|
| SonarQube is unreachable | Check that Docker containers are running and SonarQube has finished starting. |
| Invalid SonarQube token | Generate a new token and update the `SONAR_TOKEN` value in `.env`. |
| `sonar-scanner` not found | Install SonarScanner CLI and add its `bin` directory to PATH, or configure its full path. |
| `cloc` not found | Install cloc and add it to PATH. |
| Port 9001 is already in use | Stop the process using the port or change the Docker port mapping and matching SonarQube URL. |
| Port 8000 is already in use | Stop the process using the port before starting MetricScope. |
| Python dependency errors | Activate the virtual environment and reinstall dependencies using `pip install -r requirements.txt`. |

## Project Purpose

MetricScope was developed as a software metrics comparison project to study how different static analysis tools measure software quality, code size and complexity.

It brings the results from SonarQube, cloc and Lizard together in one interface to make their similarities and differences easier to understand.