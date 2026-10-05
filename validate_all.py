#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime, timezone
import json
import os
import subprocess
import sys

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent
MATRIX = ROOT / "traceability-matrix.yaml"
SCHEMA = ROOT / "traceability-matrix.schema.json"
OPENAPI = ROOT / "MeuRemedio_OpenAPI_02.33.3_COMPLETO.yaml"
SEMANTIC_VALIDATOR = ROOT / "traceability-check.py"
REPORT_DIR = ROOT / "validation-report"
JSON_REPORT = REPORT_DIR / "traceability-validation-report.json"
MARKDOWN_REPORT = REPORT_DIR / "traceability-validation-report.md"


def schema_validation():
    matrix = yaml.safe_load(MATRIX.read_text(encoding="utf-8"))
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    errors = sorted(
        Draft202012Validator(schema).iter_errors(matrix),
        key=lambda error: list(error.absolute_path),
    )
    formatted = []
    for error in errors:
        location = "/".join(str(part) for part in error.absolute_path) or "<raiz>"
        formatted.append({"location": location, "message": error.message})
    return matrix, formatted


def semantic_validation():
    result = subprocess.run(
        [sys.executable, str(SEMANTIC_VALIDATOR), str(MATRIX), str(OPENAPI)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {
            "status": "FAIL",
            "errors": [{
                "code": "invalid-validator-output",
                "message": result.stdout or result.stderr or "Sem saída do validador semântico",
            }],
        }
    return result.returncode, payload, result.stderr


def generate_reports(matrix, schema_errors, semantic_code, semantic_payload, semantic_stderr):
    REPORT_DIR.mkdir(exist_ok=True)
    passed = (
        not schema_errors
        and semantic_code == 0
        and semantic_payload.get("status") == "PASS"
    )
    report = {
        "status": "PASS" if passed else "FAIL",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "github": {
            "repository": os.getenv("GITHUB_REPOSITORY"),
            "workflow": os.getenv("GITHUB_WORKFLOW"),
            "run_id": os.getenv("GITHUB_RUN_ID"),
            "run_number": os.getenv("GITHUB_RUN_NUMBER"),
            "sha": os.getenv("GITHUB_SHA"),
            "ref": os.getenv("GITHUB_REF"),
        },
        "matrix_version": matrix.get("matrix_version"),
        "schema_validation": {
            "status": "PASS" if not schema_errors else "FAIL",
            "errors": schema_errors,
        },
        "semantic_validation": semantic_payload,
        "semantic_stderr": semantic_stderr or None,
    }
    JSON_REPORT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    lines = [
        "# Relatório de validação da rastreabilidade",
        "",
        f"**Status geral:** {'PASS' if passed else 'FAIL'}",
        f"**Versão da matriz:** {matrix.get('matrix_version', 'não informada')}",
        f"**Schema:** {'PASS' if not schema_errors else 'FAIL'}",
        f"**Validação semântica:** {'PASS' if semantic_code == 0 and semantic_payload.get('status') == 'PASS' else 'FAIL'}",
        "",
        "## Contagens",
        "",
    ]
    counts = semantic_payload.get("counts", {})
    if counts:
        lines.extend(f"- **{name}:** {value}" for name, value in counts.items())
    else:
        lines.append("- Nenhuma contagem foi produzida.")

    all_errors = []
    all_errors.extend(
        f"Schema em `{error['location']}`: {error['message']}"
        for error in schema_errors
    )
    all_errors.extend(
        f"{error.get('code', 'erro')}: {error.get('message', str(error))}"
        for error in semantic_payload.get("errors", [])
    )
    lines.extend(["", "## Erros", ""])
    if all_errors:
        lines.extend(f"- {error}" for error in all_errors)
    else:
        lines.append("- Nenhum erro encontrado.")

    MARKDOWN_REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return passed


def append_job_summary():
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary and MARKDOWN_REPORT.exists():
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write(MARKDOWN_REPORT.read_text(encoding="utf-8"))


def write_missing_report(missing):
    REPORT_DIR.mkdir(exist_ok=True)
    payload = {
        "status": "FAIL",
        "errors": [
            {"code": "missing-artifact", "message": name}
            for name in missing
        ],
    }
    JSON_REPORT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    MARKDOWN_REPORT.write_text(
        "# Relatório de validação\n\n"
        "**Status geral:** FAIL\n\n"
        "## Artefatos ausentes\n\n"
        + "\n".join(f"- {name}" for name in missing)
        + "\n",
        encoding="utf-8",
    )


def main():
    required = [MATRIX, SCHEMA, OPENAPI, SEMANTIC_VALIDATOR]
    missing = [path.name for path in required if not path.is_file()]
    if missing:
        write_missing_report(missing)
        append_job_summary()
        print(f"ERRO: artefatos ausentes: {', '.join(missing)}", file=sys.stderr)
        return 1

    print("[1/2] Validando o schema da matriz...")
    matrix, schema_errors = schema_validation()
    print("Schema aprovado." if not schema_errors else "Schema reprovado.")

    print("[2/2] Validando integridade, catálogos e rastreabilidade...")
    semantic_code, semantic_payload, semantic_stderr = semantic_validation()
    passed = generate_reports(
        matrix,
        schema_errors,
        semantic_code,
        semantic_payload,
        semantic_stderr,
    )
    append_job_summary()
    print(JSON_REPORT.read_text(encoding="utf-8"))
    print(f"Relatórios gerados em: {REPORT_DIR}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
