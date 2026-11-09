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
          keypair.privateKey,
          row.sender_id === user.id
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
  const [friendRequests, setFriendRequests] = useState({ incoming: [], outgoing: [] });
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
          if (!window.location.hash || currentPage() === "home") {
            setPage("messages");
            window.location.hash = "/messages";
          }
        }
      })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setAuthChecked(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user || !keypair) {
      setFriends([]);
      setFriendRequests({ incoming: [], outgoing: [] });
      setMessages([]);
      return;
    }
    let active = true;
    setLoadError("");
    const refresh = async () => {
      try {
        const [contacts, rows, requests] = await Promise.all([
          fetch("/api/friends").then(readJson),
          fetch("/api/messages").then(readJson),
          fetch("/api/friend-requests").then(readJson),
        ]);
        const decrypted = await decryptRows(rows, user, contacts, keypair);
        if (active) {
          setFriends(contacts);
          setFriendRequests(requests);
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
    setFriendRequests({ incoming: [], outgoing: [] });
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
        <a href="#/settings">Settings</a>
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
                setFriends={setFriends}
                friendRequests={friendRequests}
                setFriendRequests={setFriendRequests}
                messages={messages}
                setMessages={setMessages}
                keypair={keypair}
                loadError={loadError}
              />
      )}
      {page === "login" && <AccountPage mode="login" onAuthenticated={finishSignIn} />}
      {page === "register" && <AccountPage mode="register" onAuthenticated={finishSignIn} />}
      {page === "settings" && <SettingsPage />}
      {!['home', 'messages', 'login', 'register', 'settings'].includes(page) && (
        <section><h2>Page not found</h2><p>Choose a page from the navigation above.</p></section>
      )}
    </main>
  </div>;
}

function SettingsPage() {
  const categories = ["Profile", "Account", "Privacy", "Voice and Video", "Appearance", "Accessibility"];

  return <section className="page settings-page">
    <h2>Settings</h2>
    <div className="settings-categories">
      {categories.map((category) => (
        <div className="settings-category" key={category}>
          <h3>{category}</h3>
        </div>
      ))}
    </div>
  </section>;
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

function Messages({ user, friends, setFriends, friendRequests, setFriendRequests, messages, setMessages, keypair, loadError }) {
  const [friendId, setFriendId] = useState(null);
  const friend = friends.find((contact) => contact.id === friendId) || null;
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [addingFriend, setAddingFriend] = useState(false);
  const [friendUsername, setFriendUsername] = useState("");
  const [friendError, setFriendError] = useState("");
  const [friendBusy, setFriendBusy] = useState(false);

  async function addFriend(event) {
    event.preventDefault();
    setFriendBusy(true);
    setFriendError("");
    try {
      await readJson(await fetch("/api/friend-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: friendUsername }),
      }));
      const requests = await readJson(await fetch("/api/friend-requests"));
      setFriendRequests(requests);
      setFriendUsername("");
      setAddingFriend(false);
    } catch (error) {
      setFriendError(error.message);
    } finally {
      setFriendBusy(false);
    }
  }

  async function respondToRequest(requestId, action) {
    setFriendError("");
    try {
      await readJson(await fetch(`/api/friend-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }));
      const [requests, contacts] = await Promise.all([
        fetch("/api/friend-requests").then(readJson),
        fetch("/api/friends").then(readJson),
      ]);
      setFriendRequests(requests);
      setFriends(contacts);
    } catch (error) {
      setFriendError(error.message);
    }
  }

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
      <button className="add-friend-button" type="button" onClick={() => { setAddingFriend((open) => !open); setFriendError(""); }}>
        {addingFriend ? "Cancel" : "+ Add friend"}
      </button>
      {addingFriend && <form className="add-friend-form" onSubmit={addFriend}>
        <label htmlFor="friend-username">Username</label>
        <input
          id="friend-username"
          value={friendUsername}
          onChange={(event) => setFriendUsername(event.target.value)}
          placeholder="Enter username"
          maxLength={32}
          required
        />
        <button type="submit" disabled={friendBusy}>{friendBusy ? "Sending..." : "Send request"}</button>
      </form>}
      {friendRequests.incoming.length > 0 && <div className="friend-requests">
        <h4>Requests</h4>
        {friendRequests.incoming.map((item) => <div className="friend-request" key={item.id}>
          <span>{item.user.username}</span>
          <div>
            <button type="button" onClick={() => respondToRequest(item.id, "accept")}>Accept</button>
            <button type="button" onClick={() => respondToRequest(item.id, "decline")}>Decline</button>
          </div>
        </div>)}
      </div>}
      {friendRequests.outgoing.length > 0 && <div className="friend-requests">
        <h4>Sent</h4>
        {friendRequests.outgoing.map((item) => <p key={item.id}>{item.user.username} · Pending</p>)}
      </div>}
      {friendError && <p className="friend-error" role="alert">{friendError}</p>}
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
          <div><h3>{friend.username}</h3></div>
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
      </> : <div className="empty-chat"><p>Select a contact to start a conversation.</p></div>}
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
