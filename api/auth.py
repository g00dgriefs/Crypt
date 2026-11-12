import base64
import binascii
import json
import secrets

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
    if not isinstance(username, str) or not username.strip() or len(username.strip()) > 16 or "/" in username:
        return api_error("Username is required, must be at most 16 characters, and cannot contain /", 400)
    if not isinstance(email, str) or "@" not in email or len(email.strip()) > 255:
        return api_error("A valid email is required", 400)
    if not isinstance(password, str) or len(password) < 8:
        return api_error("Password must be at least 8 characters", 400)

    username = username.strip()
    identifier = secrets.randbelow(9000) + 1000
    while User.query.filter(
        db.func.lower(User.username) == username.lower(),
        User.identifier == identifier,
    ).first() is not None:
        identifier = secrets.randbelow(9000) + 1000
    user = User(
        username=username,
        identifier=identifier,
        email=email.strip().lower(),
        password_hash=hash_password(password),
    )
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_error("Email or username identifier is already registered", 409)
    
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


@auth_blueprint.put("/profile")
def update_profile():
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return api_error("Expected a JSON object", 400)

    username = data.get("username", user.username)
    display_name = data.get("display_name", user.display_name or "Crypt User")
    bio = data.get("bio", user.bio or "")
    profile_picture = data.get("profile_picture", user.profile_picture)
    if not isinstance(display_name, str) or not display_name.strip() or len(display_name.strip()) > 32:
        return api_error("Display name is required and must be at most 32 characters", 400)
    if not isinstance(username, str) or not username.strip() or len(username.strip()) > 32 or "/" in username:
        return api_error("Username is required, must be at most 32 characters, and cannot contain /", 400)
    duplicate_name = User.query.filter(
        db.func.lower(User.username) == username.strip().lower(),
        User.identifier == user.identifier,
        User.id != user.id,
    ).first()
    if duplicate_name is not None:
        return api_error("That username and identifier are already in use", 409)
    if not isinstance(bio, str) or len(bio) > 500:
        return api_error("Bio must be at most 500 characters", 400)
    if profile_picture is not None and (
        not isinstance(profile_picture, str)
        or not profile_picture.startswith((
            "data:image/png;base64,",
            "data:image/jpeg;base64,",
            "data:image/webp;base64,",
            "data:image/gif;base64,",
        ))
        or len(profile_picture) > 1_950_000
    ):
        return api_error("Profile picture must be a supported image under 1.4 MB", 400)

    user.username = username.strip()
    user.display_name = display_name.strip()
    user.bio = bio.strip()
    user.profile_picture = profile_picture
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_error("That username and identifier are already in use", 409)
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


@auth_blueprint.get("/device-key-backup")
def get_device_key_backup():
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    if user.encrypted_key_backup is None:
        return api_error("No encrypted device key backup is available for this account", 404)
    return jsonify({"backup": json.loads(user.encrypted_key_backup)})


@auth_blueprint.put("/device-key-backup")
def save_device_key_backup():
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    if user.public_key is None:
        return api_error("Set up the account encryption key before saving its backup", 409)
    data = request.get_json(silent=True)
    backup = data.get("backup") if isinstance(data, dict) else None
    required_fields = (
        "version", "kdf", "opslimit", "memlimit", "public_key", "salt", "nonce",
        "encrypted_private_key",
    )
    if not isinstance(backup, dict) or any(field not in backup for field in required_fields):
        return api_error("A complete encrypted key backup is required", 400)
    if backup.get("version") != 1 or backup.get("kdf") != "argon2id13":
        return api_error("Unsupported encrypted key backup format", 400)
    try:
        backup_public_key = base64.b64decode(
            backup["public_key"], altchars=b"-_", validate=True
        )
    except (TypeError, binascii.Error, ValueError):
        return api_error("The backup public key is invalid", 400)
    if backup_public_key != user.public_key:
        return api_error("The backup does not match this account's public key", 409)
    if not all(isinstance(backup[field], str) for field in (
        "public_key", "salt", "nonce", "encrypted_private_key"
    )):
        return api_error("Encrypted key backup fields must be strings", 400)

    serialized = json.dumps(backup, separators=(",", ":"), sort_keys=True)
    if len(serialized) > 10_000:
        return api_error("Encrypted key backup is too large", 400)
    if user.encrypted_key_backup is not None and user.encrypted_key_backup != serialized:
        return api_error("An encrypted key backup already exists for this account", 409)
    user.encrypted_key_backup = serialized
    db.session.commit()
    return jsonify({"ok": True})
