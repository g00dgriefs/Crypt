Crypt – Secure Messaging Application

1. Project Overview

Crypt is a secure messaging application developed to provide users with a platform for secure communication, this platforms allows users to create accounts, manage profiles and connect with friends through the friend system with encrypted messaging. 

2. Project Objectives
The main objectives of Crypt are:

 * Provide Secure messaging platform
 * Allow users to register and login
 * Allow users to create and customize their own profiles
 * Allow users to send and receive messages & images which are encrypted 
 * Implement High end-to-end Encryption to protects users message content
 * Allow users to add each other as friends
 * Provide a straight forward and easy to use interface


3. Main Features

 * User Authentication : Users can register and login to their profiles
 * User Profiles : Users can customize their profiles with pictures, bios and comments
 * Friend System : Users can add friends using their username and unique ID
 * Encrypted Messages and Images : Users can send and receive messages and images that are encrypted
 * Key Management : Crypt uses private and public keys to protect message content


4. Technologies Used

  * React - Frontend Userface
  * JavaScript - Frontend Functionality
  * Python - Backend Development
  * Flask - Backend Framework and API
  * PostgreSQL - Database management
  * SQLAlchemy - Database Interaction
  * Libsodium - Encryption and Cryptographic operations (Flask-CORS & PyNaCI)
  * HTML & CSS - Application Structure and Styling


 5. Prerequisites

  * Python
  * Node.js & npm
  * PostgreSQL
    

6. Installation Instructions 

   Step 1 - Download the Project

   Download the Crypt project from the GitHub repository by selecting Code → Download ZIP.

   Extract the ZIP file and open the Crypt project folder in Visual Studio Code

   Step 2 - Setup Python Environment

    Create Python Virtual Environment - Put this in your visual studio code terminal "python -m venv .venv"

    Active the Virtual Environment -
          MAC OS - source .venv/bin/activate
          Windows - .venv\Scripts\activate


    Step 3 - Install Backend Dependencies

     With your Virtual Environment Activated, Run - "pip install -r requirements.txt" In your terminal


    Step 4 - Install Frontend Dependencies

     Navigate to the frontend directory using - "cd frontend"

     Install the require packages using - "npm install"


8. Backend Dependencies
   * Flask
   * Flask-CORS
   * Flask-JWT-Extended
   * Flask-Migrate
   * Flask-SQLAlchemy
   * PyNaCI
   * Psycopg(binary)
   * Python-dotenv


9. Running the Application 

   Starting the Flask Backend - Open the main Crypt Project Terminal

   Activate the Python Virtual Environment: "source .venv/bin/activate"

   Start the Backend: "python app.py"


   Starting the React Frontend - Open a secondary Terminal 
   
   move to the frontend directory - "cd frontend"

   Start the Development Server - "npm run dev"

   Once both the frontend and backend are running open the local frontend address displayed by Vite on your browser (Chrome or Firefox)


10. Security and Encryption
    Crypt uses Libsodium through PyNaCI and Javascript Cryptographic Libraries to implement encryption functionality
   this ensures messages are encrypted on the senders device before being transmitted to the backend, the intended
   users then uses their private encryption key to then decrypt the encrypted messages on their device.

11. Known Limitations

    * Current Image Attachment Size Restrictions (150KB)
    * Some Browsers are incompatible 

   



 
