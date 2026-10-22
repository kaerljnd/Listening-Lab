import os
import time
import uuid
import json
import hmac
from functools import wraps

from flask import Flask, request, jsonify
from tablestore import (
    OTSClient,
    Row,
    Condition,
    RowExistenceExpectation,
    Direction,
    INF_MIN,
    INF_MAX,
)

app = Flask(__name__)

OTS_ENDPOINT = os.environ["OTS_ENDPOINT"]
OTS_INSTANCE = os.environ["OTS_INSTANCE"]

ALLOWED_SET_IDS = {"20260830A", "20260908A", "20260909A", "20260909B", "20260915A", "20260916A", "20260920A", "20260923A", "20261004A", "20261005A"}
TEACHER_KEY = os.environ.get("TEACHER_KEY", "").strip()

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


def teacher_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not TEACHER_KEY:
            return jsonify({"ok": False, "error": "teacher access is not configured"}), 503
        supplied = request.headers.get("X-Teacher-Key", "")
        if not supplied or not hmac.compare_digest(supplied, TEACHER_KEY):
            return jsonify({"ok": False, "error": "teacher access denied"}), 401
        return fn(*args, **kwargs)
    return wrapped


def row_to_dict(row):
    if row is None:
        return None
    data = {}
    for item in row.primary_key or []:
        if len(item) >= 2:
            data[item[0]] = item[1]
    for item in row.attribute_columns or []:
        if len(item) >= 2:
            data[item[0]] = item[1]
    return data


def get_range_all(table_name, start_pk, end_pk, limit_per_page=500, hard_limit=10000):
    client = get_ots_client()
    rows_out = []
    current = start_pk
    while current is not None and len(rows_out) < hard_limit:
        remaining = hard_limit - len(rows_out)
        page_limit = min(limit_per_page, remaining)
        _, next_pk, rows, _ = client.get_range(
            table_name,
            Direction.FORWARD,
            current,
            end_pk,
            limit=page_limit,
            max_version=1,
        )
        rows_out.extend(rows)
        if next_pk is None:
            break
        current = next_pk
    return [row_to_dict(row) for row in rows_out]


def get_session_children(table_name, session_id, second_key):
    return get_range_all(
        table_name,
        [("session_id", session_id), (second_key, INF_MIN)],
        [("session_id", session_id), (second_key, INF_MAX)],
    )


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")

    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin

    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Teacher-Key"

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
        "version": "classroom-pilot-0.6.5-telemetry"
    })


# =========================================================
# TEACHER READ API
# =========================================================

@app.route("/teacher/sessions", methods=["OPTIONS"])
def teacher_sessions_options():
    return "", 204


@app.route("/teacher/sessions", methods=["GET"])
@teacher_required
def teacher_sessions():
    try:
        requested = int(request.args.get("limit", "200"))
    except ValueError:
        requested = 200
    limit = max(1, min(requested, 1000))

    sessions = get_range_all(
        "sessions",
        [("session_id", INF_MIN)],
        [("session_id", INF_MAX)],
        hard_limit=max(limit, 1000),
    )
    sessions.sort(key=lambda item: int(item.get("started_at") or 0), reverse=True)
    sessions = sessions[:limit]

    return jsonify({
        "ok": True,
        "sessions": sessions,
        "count": len(sessions),
    }), 200


@app.route("/teacher/session/<session_id>", methods=["OPTIONS"])
def teacher_session_detail_options(session_id):
    return "", 204


@app.route("/teacher/session/<session_id>", methods=["GET"])
@teacher_required
def teacher_session_detail(session_id):
    session_id = text_value(session_id)
    client = get_ots_client()

    _, session_row, _ = client.get_row(
        "sessions",
        [("session_id", session_id)],
        max_version=1,
    )

    if session_row is None:
        return jsonify({"ok": False, "error": "session not found"}), 404

    responses = get_session_children("question_responses", session_id, "question_id")
    attempts = get_session_children("question_attempts", session_id, "question_id")
    analyses = get_session_children("material_analysis", session_id, "material_id")

    return jsonify({
        "ok": True,
        "session": row_to_dict(session_row),
        "responses": responses,
        "attempts": attempts,
        "material_analysis": analyses,
    }), 200


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

    if "initial_answer" in data:
        attribute_columns.append(("initial_answer", text_value(data.get("initial_answer"))))

    if "selection_history" in data:
        attribute_columns.append(("selection_history", json_value(data.get("selection_history"))))

    for field in ["selection_count", "change_count"]:
        if data.get(field) is not None:
            try:
                attribute_columns.append((field, int(data.get(field))))
            except (TypeError, ValueError):
                return jsonify({"ok": False, "error": f"{field} must be an integer"}), 400

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
        "function_tag",
        "key_meaning",
    ]

    for field in optional_text_fields:
        if field in data:
            attribute_columns.append((field, text_value(data.get(field))))

    for field in [
        "error_reasons",
        "second_selection_history",
        "post_selection_history",
        "post_review",
    ]:
        if field in data:
            attribute_columns.append((field, json_value(data.get(field))))

    for field in ["second_change_count", "post_change_count"]:
        if data.get(field) is not None:
            try:
                attribute_columns.append((field, int(data.get(field))))
            except (TypeError, ValueError):
                return jsonify({"ok": False, "error": f"{field} must be an integer"}), 400

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

    if "topic_dont_know" in data:
        attribute_columns.append(("topic_dont_know", 1 if data.get("topic_dont_know") else 0))

    if "main_dont_know" in data:
        attribute_columns.append(("main_dont_know", 1 if data.get("main_dont_know") else 0))

    if "transcript_viewed" in data:
        attribute_columns.append(("transcript_viewed", 1 if data.get("transcript_viewed") else 0))

    if "replay_decision" in data:
        attribute_columns.append(("replay_decision", text_value(data.get("replay_decision"))))

    if data.get("replay_count") is not None:
        try:
            attribute_columns.append(("replay_count", int(data.get("replay_count"))))
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "replay_count must be an integer"}), 400

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
