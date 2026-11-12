import binascii

from flask import Blueprint, jsonify, request
from sqlalchemy import or_

from api.helpers import api_error, current_user, user_json
from crypto import decode_payload, encode_payload
from extensions import db
from models import FriendRequest, Message, User

messages_blueprint = Blueprint("messages_api", __name__)


@messages_blueprint.get("/friends")
def friends():
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    accepted = FriendRequest.query.filter(
        FriendRequest.status == "accepted",
        or_(FriendRequest.requester_id == user.id, FriendRequest.addressee_id == user.id),
    ).all()
    friend_ids = {
        row.addressee_id if row.requester_id == user.id else row.requester_id
        for row in accepted
    }
    contacts = User.query.filter(User.id.in_(friend_ids)).order_by(User.display_name, User.username).all() if friend_ids else []
    return jsonify([user_json(contact) for contact in contacts])


@messages_blueprint.get("/friend-requests")
def friend_requests():
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    incoming = FriendRequest.query.filter_by(addressee_id=user.id, status="pending").all()
    outgoing = FriendRequest.query.filter_by(requester_id=user.id, status="pending").all()
    return jsonify({
        "incoming": [friend_request_json(row, row.requester) for row in incoming],
        "outgoing": [friend_request_json(row, row.addressee) for row in outgoing],
    })


@messages_blueprint.post("/friend-requests")
def create_friend_request():
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    data = request.get_json(silent=True)
    handle = data.get("handle") if isinstance(data, dict) else None
    if not isinstance(handle, str) or "/" not in handle.strip():
        return api_error("Enter the full username and identifier, such as goku/4011", 400)
    username, identifier_text = handle.strip().rsplit("/", 1)
    username = username.strip()
    if not username or not identifier_text.isdigit() or len(identifier_text) != 4:
        return api_error("Enter the full username and four-digit identifier, such as goku/4011", 400)
    identifier = int(identifier_text)
    target = User.query.filter(
        db.func.lower(User.username) == username.lower(),
        User.identifier == identifier,
    ).first()
    if target is None:
        return api_error("No user found with that username and identifier", 404)
    if target.id == user.id:
        return api_error("Cannot add yourself", 400)
    existing = FriendRequest.query.filter(
        or_(
            (FriendRequest.requester_id == user.id) & (FriendRequest.addressee_id == target.id),
            (FriendRequest.requester_id == target.id) & (FriendRequest.addressee_id == user.id),
        )
    ).all()
    if any(row.status == "accepted" for row in existing):
        return api_error("You are already friends", 409)
    if any(row.requester_id == user.id and row.status == "pending" for row in existing):
        return api_error("Friend request already sent", 409)
    if any(row.requester_id == target.id and row.status == "pending" for row in existing):
        return api_error("This user has already sent you a request. Accept it from incoming requests.", 409)
    row = next((item for item in existing if item.requester_id == user.id), None)
    if row:
        row.status = "pending"
        row.updated_at = db.func.now()
    else:
        row = FriendRequest(requester_id=user.id, addressee_id=target.id)
        db.session.add(row)
    db.session.commit()
    return jsonify(friend_request_json(row, target)), 201


@messages_blueprint.patch("/friend-requests/<int:request_id>")
def update_friend_request(request_id):
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    row = db.session.get(FriendRequest, request_id)
    if row is None:
        return api_error("Friend request not found", 404)
    if row.addressee_id != user.id:
        return api_error("Only the recipient can respond to this request", 403)
    if row.status != "pending":
        return api_error("Friend request is no longer pending", 409)
    data = request.get_json(silent=True)
    action = data.get("action") if isinstance(data, dict) else None
    if action not in ("accept", "decline"):
        return api_error("action must be accept or decline", 400)
    row.status = "accepted" if action == "accept" else "declined"
    db.session.commit()
    return jsonify(friend_request_json(row, row.requester))


@messages_blueprint.delete("/friend-requests/<int:request_id>")
def cancel_friend_request(request_id):
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    row = db.session.get(FriendRequest, request_id)
    if row is None:
        return api_error("Friend request not found", 404)
    if row.requester_id != user.id:
        return api_error("Only the sender can cancel this request", 403)
    if row.status != "pending":
        return api_error("Only pending requests can be cancelled", 409)
    db.session.delete(row)
    db.session.commit()
    return jsonify({"ok": True})


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
        friendship = FriendRequest.query.filter(
            FriendRequest.status == "accepted",
            or_(
                (FriendRequest.requester_id == user.id) & (FriendRequest.addressee_id == recipient.id),
                (FriendRequest.requester_id == recipient.id) & (FriendRequest.addressee_id == user.id),
            ),
        ).first()
        if friendship is None:
            return api_error("You can only message accepted friends", 403)
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


def friend_request_json(row, other_user):
    return {"id": row.id, "status": row.status, "created_at": row.created_at.isoformat(), "user": user_json(other_user)}


def message_json(message):
    return {
        "id": message.id,
        "sender_id": message.sender_id,
        "recipient_id": message.recipient_id,
        "encrypted_payload": encode_payload(message.encrypted_payload),
        "created_at": message.created_at.isoformat(),
    }
