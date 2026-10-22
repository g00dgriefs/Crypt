import os

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, send_from_directory


from extensions import db, migrate
from models import User, Message
import models  # noqa: F401 - registers the models with SQLAlchemy migrations

load_dotenv()

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
    "DATABASE_URL", "sqlite:///crypt.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)
migrate.init_app(app, db)

@app.get("/css/<path:filename>")
def frontend_css(filename):
    return send_from_directory("frontend/src", filename)

@app.get("/api/friends")
def api_friends():
    return jsonify([])


@app.get("/api/messages")
def api_messages():
    user_id= session.get(user_id)

    if not user_id:
        return jsonify([])
    
    send_to = db.session.query(Message.recipient_id).filter(
        Message.sender_id == user_id
    )

    received_from = db.session.query(Message.sender_id).filter(
        Message.recipient_id == user_id
    )

    friends_ids = sent_to.union(received_from).subquery()

    
    friends = User.query.filter(
        User.id.in_(db.session.query(friend_ids.c[0]))
    ).all()

    return jsonify([
        {"id": friend.id, "username": friend.username}
        for friend in friends
    ])



@app.get("/")
def home():
    return render_template("home.html")


@app.get("/messages")
def messages():
    return render_template("messages.html")


@app.get("/login")
def login():
    return render_template("login.html")


@app.get("/register")
def register():
    return render_template("register.html")


if __name__ == "__main__":
    app.run(debug=True)
