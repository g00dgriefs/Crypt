from flask import Blueprint

from api.auth import auth_blueprint
from api.messages import messages_blueprint
from api.profiles import profiles_blueprint

api_blueprint = Blueprint("api", __name__, url_prefix="/api")
api_blueprint.register_blueprint(auth_blueprint)
api_blueprint.register_blueprint(messages_blueprint)
api_blueprint.register_blueprint(profiles_blueprint)
