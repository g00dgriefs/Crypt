from flask import Flask, jsonify, render_template

app = Flask(__name__)

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
