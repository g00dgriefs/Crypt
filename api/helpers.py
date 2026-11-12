import base64

from flask import jsonify, session

from extensions import db
from models import User


def api_error(message, status):
    return jsonify({"error": message}), status


def current_user():
    user_id = session.get("user_id")
    return db.session.get(User, user_id) if user_id is not None else None


def user_json(user):
    return {
        "id": user.id,
        "username": user.username,
        "identifier": user.identifier,
        "display_name": user.display_name or "Crypt User",
        "bio": user.bio or "",
        "profile_picture": user.profile_picture,
        "public_key": base64.urlsafe_b64encode(user.public_key).decode("ascii")
        if user.public_key
        else None,
    }
