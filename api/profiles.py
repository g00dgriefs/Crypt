from flask import Blueprint, jsonify, request
from sqlalchemy import or_

from api.helpers import api_error, current_user, user_json
from extensions import db
from models import FriendRequest, ProfileComment, User


profiles_blueprint = Blueprint("profiles_api", __name__)


@profiles_blueprint.get("/profiles/<int:user_id>/comments")
def profile_comments(user_id):
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    profile = db.session.get(User, user_id)
    if profile is None:
        return api_error("Profile not found", 404)
    if not can_view_profile_comments(user, profile):
        return api_error("Profile comments are not visible to you", 403)
    comments = ProfileComment.query.filter_by(profile_id=user_id).order_by(
        ProfileComment.created_at, ProfileComment.id
    ).all()
    return jsonify([comment_json(comment) for comment in comments])


@profiles_blueprint.get("/users/search")
def search_user():
    viewer = current_user()
    if viewer is None:
        return api_error("Login required", 401)
    handle = request.args.get("handle", "").strip()
    if "/" not in handle:
        return api_error("Enter a username and four-digit identifier", 400)
    username, identifier_text = handle.rsplit("/", 1)
    username = username.strip()
    if not username or not identifier_text.isdigit() or len(identifier_text) != 4:
        return api_error("Enter a username and four-digit identifier", 400)
    user = User.query.filter(
        db.func.lower(User.username) == username.lower(),
        User.identifier == int(identifier_text),
    ).first()
    if user is None:
        return api_error("No user found with that username and identifier", 404)
    return jsonify(user_json(user))


@profiles_blueprint.post("/profiles/<int:user_id>/comments")
def create_profile_comment(user_id):
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    profile = db.session.get(User, user_id)
    if profile is None:
        return api_error("Profile not found", 404)
    if not can_view_profile_comments(user, profile):
        return api_error("Profile comments are not visible to you", 403)
    data = request.get_json(silent=True)
    content = data.get("content") if isinstance(data, dict) else None
    if not isinstance(content, str) or not content.strip() or len(content.strip()) > 1000:
        return api_error("Comment is required and must be at most 1000 characters", 400)

    comment = ProfileComment(profile_id=user_id, author_id=user.id, content=content.strip())
    db.session.add(comment)
    db.session.commit()
    return jsonify(comment_json(comment)), 201


@profiles_blueprint.delete("/profiles/<int:user_id>/comments/<int:comment_id>")
def delete_profile_comment(user_id, comment_id):
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    if user.id != user_id:
        return api_error("Only the profile owner can delete comments on this profile", 403)
    comment = ProfileComment.query.filter_by(id=comment_id, profile_id=user_id).first()
    if comment is None:
        return api_error("Comment not found", 404)
    db.session.delete(comment)
    db.session.commit()
    return jsonify({"ok": True})


def can_view_profile_comments(viewer, profile):
    if viewer.id == profile.id:
        return True
    visibility = profile.profile_comment_visibility or "everybody"
    if visibility == "everybody":
        return True
    if visibility == "nobody":
        return False
    return FriendRequest.query.filter(
        FriendRequest.status == "accepted",
        or_(
            (FriendRequest.requester_id == viewer.id) & (FriendRequest.addressee_id == profile.id),
            (FriendRequest.requester_id == profile.id) & (FriendRequest.addressee_id == viewer.id),
        ),
    ).first() is not None


def comment_json(comment):
    return {
        "id": comment.id,
        "content": comment.content,
        "created_at": comment.created_at.isoformat(),
        "author": user_json(comment.author),
    }
