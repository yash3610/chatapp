import { io } from 'socket.io-client';

const API_BASE = process.env.SMOKE_API_BASE || 'http://localhost:5000/api';
const SOCKET_BASE = process.env.SMOKE_SOCKET_BASE || 'http://localhost:5000';
const RUN_IMAGE_TEST = process.env.SMOKE_IMAGE_TEST === 'true';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const nowSuffix = Date.now();
const userA = {
  name: `Smoke A ${nowSuffix}`,
  email: `smoke.a.${nowSuffix}@example.com`,
  password: 'test1234',
};
const userB = {
  name: `Smoke B ${nowSuffix}`,
  email: `smoke.b.${nowSuffix}@example.com`,
  password: 'test1234',
};

const postJson = async (url, body, token) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Request failed: ${res.status}`);
  }
  return data;
};

const getJson = async (url, token) => {
  const res = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Request failed: ${res.status}`);
  }
  return data;
};

const patchJson = async (url, body, token) => {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Request failed: ${res.status}`);
  }
  return data;
};

const uploadImage = async (token) => {
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAtMB9v+uN3wAAAAASUVORK5CYII=';
  const imageBuffer = Buffer.from(tinyPngBase64, 'base64');

  const formData = new FormData();
  formData.append('image', new Blob([imageBuffer], { type: 'image/png' }), 'smoke.png');

  const res = await fetch(`${API_BASE}/messages/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Image upload failed: ${res.status}`);
  }

  return data.imageUrl;
};

const connectSocket = (token) => {
  return io(SOCKET_BASE, {
    auth: { token },
    transports: ['websocket'],
    timeout: 8000,
  });
};

const withTimeout = (promise, label, timeoutMs = 10000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
};

const main = async () => {
  let socketA;
  let socketB;

  try {
    console.log('1. Registering users...');
    await postJson(`${API_BASE}/auth/register`, userA);
    await postJson(`${API_BASE}/auth/register`, userB);

    console.log('2. Logging in users...');
    const loginA = await postJson(`${API_BASE}/auth/login`, {
      email: userA.email,
      password: userA.password,
    });
    const loginB = await postJson(`${API_BASE}/auth/login`, {
      email: userB.email,
      password: userB.password,
    });

    const tokenA = loginA.token;
    const tokenB = loginB.token;

    assert(tokenA && tokenB, 'JWT tokens were not returned');

    console.log('3. Fetching users list...');
    const usersForA = await getJson(`${API_BASE}/users`, tokenA);
    const userBFromList = usersForA.find((entry) => entry.email === userB.email);
    assert(Boolean(userBFromList), 'User B not found in User A list');

    console.log('4. Connecting Socket.IO clients...');
    socketA = connectSocket(tokenA);
    socketB = connectSocket(tokenB);

    await withTimeout(
      Promise.all([
        new Promise((resolve, reject) => {
          socketA.once('connect', resolve);
          socketA.once('connect_error', reject);
        }),
        new Promise((resolve, reject) => {
          socketB.once('connect', resolve);
          socketB.once('connect_error', reject);
        }),
      ]),
      'Socket connection'
    );

    await wait(250);

    console.log('5. Sending realtime text message and checking delivery...');
    const receiveOnB = new Promise((resolve) => {
      socketB.on('receive_message', (message) => {
        if (message.text === 'Smoke test message') {
          resolve(message);
        }
      });
    });

    socketA.emit('private_message', {
      to: loginB.user.id,
      text: 'Smoke test message',
    });

    const messageOnB = await withTimeout(receiveOnB, 'Realtime message delivery');
    assert(messageOnB.text === 'Smoke test message', 'Unexpected message text');

    console.log('6. Marking message as seen and checking status update...');
    const seenUpdateOnA = new Promise((resolve) => {
      socketA.on('message_status_update', (payload) => {
        if (payload.status === 'seen' && payload.messageIds?.includes(String(messageOnB._id))) {
          resolve(payload);
        }
      });
    });

    socketB.emit('mark_seen', { withUserId: loginA.user.id });
    await withTimeout(seenUpdateOnA, 'Seen status update');

    console.log('7. Verifying conversation history + pagination payload...');
    const conversation = await getJson(`${API_BASE}/messages/${loginB.user.id}?limit=25`, tokenA);
    assert(Array.isArray(conversation.messages), 'Conversation messages should be an array');
    assert(typeof conversation.hasMore === 'boolean', 'Conversation hasMore should be boolean');
    assert('nextCursor' in conversation, 'Conversation nextCursor is missing');

    const latest = conversation.messages.at(-1);
    assert(latest?.text === 'Smoke test message', 'Latest conversation message mismatch');

    console.log('8. Verifying seen status persistence via API fallback...');
    await patchJson(`${API_BASE}/messages/seen/${loginA.user.id}`, {}, tokenB);

    if (RUN_IMAGE_TEST) {
      console.log('9. Uploading image and sending image message...');
      const imageUrl = await uploadImage(tokenA);
      assert(Boolean(imageUrl), 'Image URL missing from upload response');

      const imageReceiveOnB = new Promise((resolve) => {
        socketB.on('receive_message', (message) => {
          if (String(message.sender?._id || message.sender) === String(loginA.user.id) && message.imageUrl) {
            resolve(message);
          }
        });
      });

      socketA.emit('private_message', {
        to: loginB.user.id,
        text: '',
        imageUrl,
      });

      const imageMessage = await withTimeout(imageReceiveOnB, 'Realtime image message');
      assert(Boolean(imageMessage.imageUrl), 'Image message missing imageUrl');
      console.log('   Image upload + message check passed.');
    } else {
      console.log('9. Image test skipped. Set SMOKE_IMAGE_TEST=true to enable (requires Cloudinary config).');
    }

    console.log('All smoke checks passed.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Smoke test failed:', error.message);
    process.exitCode = 1;
  } finally {
    await wait(300);
    socketA?.disconnect();
    socketB?.disconnect();
  }
};

main();
