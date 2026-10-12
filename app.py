import os

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template

from extensions import db, migrate
import models  # noqa: F401 - registers the models with SQLAlchemy migrations

load_dotenv()

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
    "DATABASE_URL", "sqlite:///crypt.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)
migrate.init_app(app, db)

@app.get("/api/friends")
def api_friends():
    return jsonify([])


@app.get("/api/messages")
def api_messages():
    return jsonify([])


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
