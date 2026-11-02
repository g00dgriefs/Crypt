import binascii

from flask import Blueprint, jsonify, request
from sqlalchemy import or_

from api.helpers import api_error, current_user, user_json
from crypto import decode_payload, encode_payload
from extensions import db
from models import Message, User

messages_blueprint = Blueprint("messages_api", __name__)


@messages_blueprint.get("/friends")
def friends():
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    # There is no separate friend-request model yet; all registered users are contacts.
    contacts = User.query.filter(User.id != user.id).order_by(User.username).all()
    return jsonify([user_json(contact) for contact in contacts])


@messages_blueprint.route("/messages", methods=["GET", "POST"])
def messages():
    user = current_user()
    if user is None:
        return api_error("Login required", 401)

    if request.method == "POST":
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return api_error("Expected a JSON object", 400)
        recipient_id = data.get("recipient_id")
        encoded_payload = data.get("encrypted_payload")
        if isinstance(recipient_id, bool) or not isinstance(recipient_id, int):
            return api_error("recipient_id must be an integer", 400)
        recipient = db.session.get(User, recipient_id)
        if recipient is None:
            return api_error("Recipient not found", 404)
        if recipient.id == user.id:
            return api_error("Cannot message yourself", 400)
        if not recipient.public_key:
            return api_error("Recipient has not set up encryption yet", 409)
        if not isinstance(encoded_payload, str) or len(encoded_payload) > 1_400_000:
            return api_error("encrypted_payload is required and limited to 1 MB", 400)
        try:
            payload = decode_payload(encoded_payload)
        except (binascii.Error, ValueError):
            return api_error("encrypted_payload must be valid URL-safe base64", 400)
        if len(payload) < 40:
            return api_error("encrypted_payload is not a valid NaCl Box payload", 400)

        message = Message(
            sender_id=user.id,
            recipient_id=recipient.id,
            encrypted_payload=payload,
        )
        db.session.add(message)
        db.session.commit()
        return jsonify(message_json(message)), 201

    friend_id = request.args.get("friend_id", type=int)
    query = Message.query.filter(
        or_(Message.sender_id == user.id, Message.recipient_id == user.id)
    )
    if friend_id is not None:
        query = query.filter(
            or_(
                (Message.sender_id == user.id) & (Message.recipient_id == friend_id),
                (Message.sender_id == friend_id) & (Message.recipient_id == user.id),
            )
        )
    rows = query.order_by(Message.created_at, Message.id).all()
    return jsonify([message_json(message) for message in rows])


def message_json(message):
    return {
        "id": message.id,
        "sender_id": message.sender_id,
        "recipient_id": message.recipient_id,
        "encrypted_payload": encode_payload(message.encrypted_payload),
        "created_at": message.created_at.isoformat(),
    }
