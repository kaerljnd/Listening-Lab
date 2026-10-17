import os
import time
import uuid
import json

from flask import Flask, request, jsonify
from tablestore import (
    OTSClient,
    Row,
    Condition,
    RowExistenceExpectation,
)

app = Flask(__name__)

OTS_ENDPOINT = os.environ["OTS_ENDPOINT"]
OTS_INSTANCE = os.environ["OTS_INSTANCE"]

ALLOWED_SET_IDS = {"20260920A"}

ALLOWED_ORIGINS = {
    "https://kaerljnd.github.io",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
}


def get_ots_client():
    return OTSClient(
        OTS_ENDPOINT,
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_ID"],
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_SECRET"],
        OTS_INSTANCE,
        sts_token=os.environ["ALIBABA_CLOUD_SECURITY_TOKEN"],
    )


def now_ms():
    return int(time.time() * 1000)


def text_value(value):
    if value is None:
        return ""
    return str(value).strip()


def json_value(value):
    if value is None:
        return ""
    return json.dumps(value, ensure_ascii=False)


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")

    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin

    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"

    return response


# =========================================================
# HEALTH
# =========================================================

@app.route("/", methods=["GET"])
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "service": "listening-lab-api",
        "version": "classroom-pilot-0.4.1"
    })


# =========================================================
# SESSION
# =========================================================

@app.route("/session", methods=["OPTIONS"])
def session_options():
    return "", 204


@app.route("/session", methods=["POST"])
def create_session():
    data = request.get_json(silent=True) or {}

    student_code = text_value(data.get("student_code"))
    set_id = text_value(data.get("set_id"))
    material_id = text_value(data.get("material_id"))
    practice_mode = text_value(data.get("practice_mode"))
    module_id = text_value(data.get("module_id"))

    if not student_code:
        return jsonify({"ok": False, "error": "student_code is required"}), 400

    if len(student_code) > 40:
        return jsonify({"ok": False, "error": "student_code is too long"}), 400

    if set_id not in ALLOWED_SET_IDS:
        return jsonify({"ok": False, "error": "set_id is not allowed"}), 400

    session_id = text_value(data.get("session_id")) or f"sess_{uuid.uuid4().hex}"
    timestamp = now_ms()

    primary_key = [("session_id", session_id)]

    attribute_columns = [
        ("student_code", student_code),
        ("set_id", set_id),
        ("material_id", material_id),
        ("practice_mode", practice_mode),
        ("module_id", module_id),
        ("status", "in_progress"),
        ("started_at", timestamp),
        ("updated_at", timestamp),
    ]

    client = get_ots_client()
    client.put_row(
        "sessions",
        Row(primary_key, attribute_columns),
        Condition(RowExistenceExpectation.IGNORE)
    )

    return jsonify({
        "ok": True,
        "session_id": session_id,
        "status": "in_progress"
    }), 201


@app.route("/session/status", methods=["OPTIONS"])
def session_status_options():
    return "", 204


@app.route("/session/status", methods=["POST"])
def update_session_status():
    data = request.get_json(silent=True) or {}

    session_id = text_value(data.get("session_id"))
    status = text_value(data.get("status"))

    if not session_id:
        return jsonify({"ok": False, "error": "session_id is required"}), 400

    if status not in {"completed", "abandoned"}:
        return jsonify({"ok": False, "error": "invalid status"}), 400

    timestamp = now_ms()
    primary_key = [("session_id", session_id)]
    put_columns = [
        ("status", status),
        ("ended_at", timestamp),
        ("updated_at", timestamp),
    ]

    if status == "completed":
        put_columns.append(("completed_at", timestamp))

    client = get_ots_client()
    client.update_row(
        "sessions",
        Row(primary_key, {"PUT": put_columns}),
        Condition(RowExistenceExpectation.EXPECT_EXIST)
    )

    return jsonify({
        "ok": True,
        "session_id": session_id,
        "status": status,
        "ended_at": timestamp
    }), 200


# =========================================================
# FIRST ATTEMPT RESPONSE
# =========================================================

@app.route("/response", methods=["OPTIONS"])
def response_options():
    return "", 204


@app.route("/response", methods=["POST"])
def save_response():
    data = request.get_json(silent=True) or {}

    session_id = text_value(data.get("session_id"))
    question_id = text_value(data.get("question_id"))

    if not session_id:
        return jsonify({"ok": False, "error": "session_id is required"}), 400

    if not question_id:
        return jsonify({"ok": False, "error": "question_id is required"}), 400

    primary_key = [
        ("session_id", session_id),
        ("question_id", question_id),
    ]

    attribute_columns = [
        ("updated_at", now_ms()),
        ("timeout", 1 if data.get("timeout") else 0),
    ]

    if "first_answer" in data:
        attribute_columns.append(("first_answer", text_value(data.get("first_answer"))))

    if data.get("response_ms") is not None:
        try:
            attribute_columns.append(("response_ms", int(data.get("response_ms"))))
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "response_ms must be an integer"}), 400

    if "answered_at" in data:
        attribute_columns.append(("answered_at", text_value(data.get("answered_at"))))

    client = get_ots_client()
    client.put_row(
        "question_responses",
        Row(primary_key, attribute_columns),
        Condition(RowExistenceExpectation.IGNORE)
    )

    return jsonify({
        "ok": True,
        "session_id": session_id,
        "question_id": question_id
    }), 200


# =========================================================
# ANALYSIS ATTEMPT
# =========================================================

@app.route("/question", methods=["OPTIONS"])
def question_options():
    return "", 204


@app.route("/question", methods=["POST"])
def save_question():
    data = request.get_json(silent=True) or {}

    session_id = text_value(data.get("session_id"))
    question_id = text_value(data.get("question_id"))

    if not session_id:
        return jsonify({"ok": False, "error": "session_id is required"}), 400

    if not question_id:
        return jsonify({"ok": False, "error": "question_id is required"}), 400

    primary_key = [
        ("session_id", session_id),
        ("question_id", question_id),
    ]

    attribute_columns = [("updated_at", now_ms())]

    optional_text_fields = [
        "second_answer",
        "post_transcript_answer",
        "confidence",
        "resolution_stage",
    ]

    for field in optional_text_fields:
        if field in data:
            attribute_columns.append((field, text_value(data.get(field))))

    if "error_reasons" in data:
        attribute_columns.append(("error_reasons", json_value(data.get("error_reasons"))))

    if data.get("evidence_start") is not None:
        attribute_columns.append(("evidence_start", float(data.get("evidence_start"))))

    if data.get("evidence_end") is not None:
        attribute_columns.append(("evidence_end", float(data.get("evidence_end"))))

    if "analysis_skipped" in data:
        attribute_columns.append(("analysis_skipped", 1 if data.get("analysis_skipped") else 0))

    client = get_ots_client()
    client.put_row(
        "question_attempts",
        Row(primary_key, attribute_columns),
        Condition(RowExistenceExpectation.IGNORE)
    )

    return jsonify({
        "ok": True,
        "session_id": session_id,
        "question_id": question_id
    }), 200


# =========================================================
# MATERIAL ANALYSIS
# =========================================================

@app.route("/analysis", methods=["OPTIONS"])
def analysis_options():
    return "", 204


@app.route("/analysis", methods=["POST"])
def save_analysis():
    data = request.get_json(silent=True) or {}

    session_id = text_value(data.get("session_id"))
    material_id = text_value(data.get("material_id"))

    if not session_id:
        return jsonify({"ok": False, "error": "session_id is required"}), 400

    if not material_id:
        return jsonify({"ok": False, "error": "material_id is required"}), 400

    primary_key = [
        ("session_id", session_id),
        ("material_id", material_id),
    ]

    attribute_columns = [("updated_at", now_ms())]

    for field in ["topic_before", "topic_after"]:
        if field in data:
            attribute_columns.append((field, text_value(data.get(field))))

    for field in [
        "main_points_before",
        "main_points_after",
        "vocab_marks",
        "framework_issues",
    ]:
        if field in data:
            attribute_columns.append((field, json_value(data.get(field))))

    if "direct_transcript_skip" in data:
        attribute_columns.append(
            ("direct_transcript_skip", 1 if data.get("direct_transcript_skip") else 0)
        )

    if "post_unchanged" in data:
        attribute_columns.append(
            ("post_unchanged", 1 if data.get("post_unchanged") else 0)
        )

    client = get_ots_client()
    client.put_row(
        "material_analysis",
        Row(primary_key, attribute_columns),
        Condition(RowExistenceExpectation.IGNORE)
    )

    return jsonify({
        "ok": True,
        "session_id": session_id,
        "material_id": material_id
    }), 200


if __name__ == "__main__":
    port = int(os.environ.get("FC_CUSTOM_LISTEN_PORT", "9000"))
    app.run(host="0.0.0.0", port=port)
