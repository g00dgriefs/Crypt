import { useEffect, useState } from "react";

function currentPage() {
  const route = window.location.hash.replace(/^#\/?/, "");
  return route || "home";
}

export default function App() {
  const [page, setPage] = useState(currentPage);
  const [friends, setFriends] = useState([]);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const updatePage = () => setPage(currentPage());
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  useEffect(() => {
    fetch("/api/friends")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load friends");
        return response.json();
      })
      .then(setFriends)
      .catch(() => setFriends([]));
  }, []);

  useEffect(() => {
    fetch("/api/messages")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load messages");
        return response.json();
      })
      .then(setMessages)
      .catch(() => setMessages([]));
  }, []);

  return (
    <div className="page">
      <header>
        <h1>Crypt</h1>
        <nav aria-label="Main navigation">
          <a href="#/home">Home</a>
          <a href="#/messages">Messages</a>
          <a href="#/login">Login</a>
          <a href="#/register">Register</a>
        </nav>
      </header>

      <main>
        {page === "home" && <Home friends={friends} />}
        {page === "messages" && <Messages messages={messages} />}
        {page === "login" && <AccountPage mode="login" />}
        {page === "register" && <AccountPage mode="register" />}
        {!['home', 'messages', 'login', 'register'].includes(page) && (
          <section>
            <h2>Page not found</h2>
            <p>Choose a page from the navigation above.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function Home({ friends }) {
  return (
    <section>
      <h2>Friends</h2>
      {friends.length ? (
        <ul>
          {friends.map((friend) => (
            <li key={friend.id}>
              <a href="#/messages">{friend.name}</a> - {friend.status}
            </li>
          ))}
        </ul>
      ) : (
        <p>No friends yet.</p>
      )}
    </section>
  );
}

function Messages({ messages }) {
  return (
    <section>
      <h2>Messages</h2>
      {messages.length ? (
        <ul>
          {messages.map((message, index) => (
            <li key={index}>
              <strong>{message.sender}:</strong> {message.text}
            </li>
          ))}
        </ul>
      ) : (
        <p>No messages yet.</p>
      )}
    </section>
  );
}

function AccountPage({ mode }) {
  const registering = mode === "register";
  return (
    <section>
      <h2>{registering ? "Register" : "Login"}</h2>
      <p>This is a page template. Account handling is not connected yet.</p>
      <form>
        {registering && (
          <label>
            Name
            <input type="text" name="name" autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input type="email" name="email" autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete={registering ? "new-password" : "current-password"}
          />
        </label>
      </form>
    </section>
  );
}
