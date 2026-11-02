from flask import Flask, render_template, send_from_directory

from api import api_blueprint
from config import CONFIGS, DevelopmentConfig
from extensions import cors, db, migrate
import models  # noqa: F401 - registers models with SQLAlchemy migrations


def create_app(config_object=None):
    """Create and configure the Flask application."""
    app = Flask(__name__)
    app.config.from_object(DevelopmentConfig)

    if config_object is None:
        environment = app.config.get("APP_ENV", "development")
        config_object = CONFIGS.get(environment)
        if config_object is None:
            raise ValueError(f"Unknown APP_ENV: {environment}")
    if isinstance(config_object, dict):
        app.config.from_mapping(config_object)
    else:
        app.config.from_object(config_object)

    if not app.config.get("SECRET_KEY"):
        raise RuntimeError("SECRET_KEY must be set for this environment")

    db.init_app(app)
    migrate.init_app(app, db)
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": app.config.get("CORS_ORIGINS", [])}},
        supports_credentials=True,
    )
    app.register_blueprint(api_blueprint)

    @app.get("/css/<path:filename>")
    def frontend_css(filename):
        return send_from_directory("frontend/src", filename)

    @app.get("/")
    def home():
        return render_template("home.html")

    @app.get("/messages")
    def messages_page():
        return render_template("messages.html")

    @app.get("/login")
    def login_page():
        return render_template("login.html")

    @app.get("/register")
    def register_page():
        return render_template("register.html")

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=app.config["DEBUG"])
