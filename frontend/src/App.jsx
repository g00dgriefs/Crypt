import { useEffect, useState } from "react";
import {
  createOrUnlockDeviceKeys,
  decryptText,
  encodePublicKey,
  encryptText,
} from "./crypto.js";

function currentPage() {
  return window.location.hash.replace(/^#\/?/, "") || "home";
}

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

async function decryptRows(rows, user, contacts, keypair) {
  const currentUser = {
    ...user,
    public_key: user.public_key || encodePublicKey(keypair.publicKey),
  };
  return Promise.all(rows.map(async (row) => {
    const sender = row.sender_id === user.id
      ? currentUser
      : contacts.find((contact) => contact.id === row.sender_id);
    if (!sender?.public_key) {
      return { ...row, content: "Sender encryption key unavailable" };
    }
    try {
      return {
        ...row,
        content: await decryptText(
          row.encrypted_payload,
          sender.public_key,
          keypair.privateKey
        ),
      };
    } catch {
      return { ...row, content: "Unable to decrypt this message on this device" };
    }
  }));
}

export default function App() {
  const [page, setPage] = useState(currentPage);
  const [user, setUser] = useState(null);
  const [keypair, setKeypair] = useState(null);
  const [friends, setFriends] = useState([]);
  const [messages, setMessages] = useState([]);
  const [authChecked, setAuthChecked] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const updatePage = () => setPage(currentPage());
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/me")
      .then(readJson)
      .then(({ user: currentUser }) => {
        if (active) {
          setUser(currentUser);
          setPage("messages");
          window.location.hash = "/messages";
        }
      })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setAuthChecked(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user || !keypair) {
      setFriends([]);
      setMessages([]);
      return;
    }
    let active = true;
    setLoadError("");
    const refresh = async () => {
      try {
        const [contacts, rows] = await Promise.all([
          fetch("/api/friends").then(readJson),
          fetch("/api/messages").then(readJson),
        ]);
        const decrypted = await decryptRows(rows, user, contacts, keypair);
        if (active) {
          setFriends(contacts);
          setMessages(decrypted);
          setLoadError("");
        }
      } catch (error) {
        if (active) setLoadError(error.message);
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 4000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user, keypair]);

  async function finishSignIn(authenticatedUser, password) {
    setUser(authenticatedUser);
    setPage("messages");
    window.location.hash = "/messages";
    setKeyError("");
    try {
      const localKeys = await createOrUnlockDeviceKeys(authenticatedUser, password);
      setKeypair(localKeys);
    } catch (error) {
      setKeypair(null);
      setKeyError(error.message);
    }
  }

  async function unlockKey(password) {
    setKeyError("");
    try {
      const localKeys = await createOrUnlockDeviceKeys(user, password);
      setKeypair(localKeys);
    } catch (error) {
      setKeyError(error.message);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    setUser(null);
    setKeypair(null);
    setFriends([]);
    setMessages([]);
    setKeyError("");
    window.location.hash = "/home";
  }

  if (!authChecked) return <div className="app"><main><p>Loading...</p></main></div>;

  return <div className="app">
    <header>
      <h1>Crypt</h1>
      <nav aria-label="Main navigation">
        <a href="#/home">Home</a>
        <a href="#/messages">Messages</a>
        {!user && <><a href="#/login">Login</a><a href="#/register">Register</a></>}
        {user && <button type="button" onClick={logout}>Logout</button>}
      </nav>
    </header>

    <main>
      {page === "home" && <div className="home-page"><Home /></div>}
      {page === "messages" && (
        !user
          ? <section><h2>Log in to view messages</h2><a href="#/login">Login</a></section>
          : !keypair
            ? <UnlockKey onUnlock={unlockKey} error={keyError} />
            : <Messages
                user={user}
                friends={friends}
                messages={messages}
                setMessages={setMessages}
                keypair={keypair}
                loadError={loadError}
              />
      )}
      {page === "login" && <AccountPage mode="login" onAuthenticated={finishSignIn} />}
      {page === "register" && <AccountPage mode="register" onAuthenticated={finishSignIn} />}
      {!['home', 'messages', 'login', 'register'].includes(page) && (
        <section><h2>Page not found</h2><p>Choose a page from the navigation above.</p></section>
      )}
    </main>
  </div>;
}

function Home() {
  return <>
    <h1>CRYPT</h1>
    <p>Secure connections are our priority</p>
    <div className="home-buttons">
      <a href="#/login">Login</a>
      <a href="#/register">Register</a>
    </div>
  </>;
}

function UnlockKey({ onUnlock, error }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    await onUnlock(password);
    setPassword("");
    setBusy(false);
  }

  return <section className="page">
    <h2>Unlock this device</h2>
    <p>Your password unlocks the encrypted private key stored in this browser. It is not sent for this step.</p>
    <form onSubmit={submit}>
      <label>
        Account password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Unlocking..." : "Unlock"}</button>
    </form>
  </section>;
}

function Messages({ user, friends, messages, setMessages, keypair, loadError }) {
  const [friendId, setFriendId] = useState(null);
  const friend = friends.find((contact) => contact.id === friendId) || null;
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  async function send(event) {
    event.preventDefault();
    const content = message.trim();
    if (!content || !friend || !keypair || sending) return;
    if (!friend.public_key) {
      setSendError(`${friend.username} has not set up an encryption key yet.`);
      return;
    }
    setSending(true);
    setSendError("");
    try {
      const encryptedPayload = await encryptText(
        content,
        friend.public_key,
        keypair.privateKey
      );
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient_id: friend.id,
          encrypted_payload: encryptedPayload,
        }),
      });
      const sent = await readJson(response);
      setMessages((current) => [...current, { ...sent, content }]);
      setMessage("");
    } catch (error) {
      setSendError(error.message || "Message could not be sent");
    } finally {
      setSending(false);
    }
  }

  const conversation = messages.filter((item) =>
    item.sender_id === friend?.id || item.recipient_id === friend?.id
  );

  return <div className="messages-page">
    <aside className="friendslist">
      <h3>Friends</h3>
      {loadError && <p role="alert">{loadError}</p>}
      {friends.length === 0 ? <p>No contacts available</p> : friends.map((person) => (
        <button
          key={person.id}
          type="button"
          className={friend?.id === person.id ? "friend-selected" : ""}
          onClick={() => { setFriendId(person.id); setSendError(""); }}
        >
          {person.username}{!person.public_key ? " (key not set up)" : ""}
        </button>
      ))}
    </aside>
    <section className="message-window">
      {friend ? <>
        <header className="chat-header">
          <div><h3>{friend.username}</h3><p>End-to-end encrypted conversation</p></div>
          <span className="chat-status">Crypt</span>
        </header>
        <div className="chat-messages">
          {conversation.map((item) => (
            <div
              key={item.id}
              className={`message-row ${item.sender_id === user.id ? "message-own" : "message-theirs"}`}
            >
              <div className="message-sender">
                {item.sender_id === user.id ? user.username : friend.username}
              </div>
              <div className="messaging-bubble">{item.content}</div>
            </div>
          ))}
        </div>
        {sendError && <p role="alert">{sendError}</p>}
        <form className="message-form" onSubmit={send}>
          <input
            type="text"
            placeholder="Write a message..."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !friend.public_key}>
            {sending ? "Sending..." : "Send"}
          </button>
        </form>
      </> : <div className="empty-chat"><h2>Crypt</h2><p>Select a contact to start a conversation.</p></div>}
    </section>
  </div>;
}

function AccountPage({ mode, onAuthenticated }) {
  const registering = mode === "register";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    const body = { email: form.get("email"), password };
    if (registering) body.username = form.get("username");
    try {
      const response = await fetch(`/api/${registering ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJson(response);
      await onAuthenticated(result.user, password);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="page">
    <h2>{registering ? "Register" : "Login"}</h2>
    <form onSubmit={submit}>
      {registering && <label>
        Username
        <input type="text" name="username" autoComplete="username" required maxLength={32} />
      </label>}
      <label>
        Email
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete={registering ? "new-password" : "current-password"}
          required
          minLength={registering ? 8 : undefined}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Please wait..." : registering ? "Register" : "Login"}</button>
    </form>
  </section>;
}
