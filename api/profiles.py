from flask import Blueprint, jsonify, request

from api.helpers import api_error, current_user, user_json
from extensions import db
from models import ProfileComment, User


profiles_blueprint = Blueprint("profiles_api", __name__)


@profiles_blueprint.get("/profiles/<int:user_id>/comments")
def profile_comments(user_id):
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    if db.session.get(User, user_id) is None:
        return api_error("Profile not found", 404)
    comments = ProfileComment.query.filter_by(profile_id=user_id).order_by(
        ProfileComment.created_at, ProfileComment.id
    ).all()
    return jsonify([comment_json(comment) for comment in comments])


@profiles_blueprint.post("/profiles/<int:user_id>/comments")
def create_profile_comment(user_id):
    user = current_user()
    if user is None:
        return api_error("Login required", 401)
    if db.session.get(User, user_id) is None:
        return api_error("Profile not found", 404)
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


def comment_json(comment):
    return {
        "id": comment.id,
        "content": comment.content,
        "created_at": comment.created_at.isoformat(),
        "author": user_json(comment.author),
    }
