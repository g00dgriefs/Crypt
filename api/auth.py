import base64
import binascii

from flask import Blueprint, jsonify, request, session
from sqlalchemy.exc import IntegrityError

from api.helpers import api_error, current_user, user_json
from crypto import hash_password, verify_password
from extensions import db
from models import User

auth_blueprint = Blueprint("auth_api", __name__)


@auth_blueprint.post("/register")
def register():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return api_error("Expected a JSON object", 400)
    username, email, password = (
        data.get("username"),
        data.get("email"),
        data.get("password"),
    )
    if not isinstance(username, str) or not username.strip() or len(username.strip()) > 32:
        return api_error("Username is required and must be at most 32 characters", 400)
    if not isinstance(email, str) or "@" not in email or len(email.strip()) > 255:
        return api_error("A valid email is required", 400)
    if not isinstance(password, str) or len(password) < 8:
        return api_error("Password must be at least 8 characters", 400)

    user = User(
        username=username.strip(),
        email=email.strip().lower(),
        password_hash=hash_password(password),
    )
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_error("Username or email is already registered", 409)
    session.clear()
    session["user_id"] = user.id
    return jsonify({"user": user_json(user)}), 201


@auth_blueprint.post("/login")
def login():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return api_error("Expected a JSON object", 400)
    email, password = data.get("email"), data.get("password")
    if not isinstance(email, str) or not isinstance(password, str):
        return api_error("Email and password are required", 400)
    user = User.query.filter_by(email=email.strip().lower()).first()
    if user is None or not verify_password(password, user.password_hash):
        return api_error("Invalid email or password", 401)
    session.clear()
    session["user_id"] = user.id
    return jsonify({"user": user_json(user)})


@auth_blueprint.post("/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@auth_blueprint.get("/me")
def me():
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    return jsonify({"user": user_json(user)})


@auth_blueprint.put("/public-key")
def set_public_key():
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("public_key"), str):
        return api_error("public_key must be base64 encoded", 400)
    try:
        public_key = base64.b64decode(
            data["public_key"], altchars=b"-_", validate=True
        )
    except (binascii.Error, ValueError):
        return api_error("public_key must be valid base64", 400)
    if len(public_key) != 32:
        return api_error("public_key must decode to 32 bytes", 400)
    if user.public_key is not None and user.public_key != public_key:
        return api_error("An encryption key is already set for this account", 409)
    user.public_key = public_key
    db.session.commit()
    return jsonify({"public_key": data["public_key"]})
