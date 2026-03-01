const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const TelegramBot = require("node-telegram-bot-api");
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ===== ENV VARIABLES =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_CERT = process.env.AGORA_CERT;

// ===== TELEGRAM BOT =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let androidClient = null;
let streamStatus = false;

// ===== WEBSOCKET CONNECTION =====
wss.on("connection", (ws) => {
    console.log("Android connected via WebSocket");
    androidClient = ws;

    ws.on("close", () => {
        console.log("Android disconnected");
        androidClient = null;
    });
});

// ===== STATUS API =====
app.get("/status", (req, res) => {
    res.json({ stream: streamStatus });
});

// ===== GENERATE AGORA TOKEN =====
function generateToken(channel) {
    const uid = 0;
    const role = RtcRole.PUBLISHER;
    const expireTime = 3600; // 1 hour

    const currentTime = Math.floor(Date.now() / 1000);
    const privilegeExpireTime = currentTime + expireTime;

    return RtcTokenBuilder.buildTokenWithUid(
        AGORA_APP_ID,
        AGORA_CERT,
        channel,
        uid,
        role,
        privilegeExpireTime
    );
}

// ===== TELEGRAM COMMANDS =====
bot.onText(/\/start_stream/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) {
        return bot.sendMessage(msg.chat.id, "❌ Not Authorized");
    }

    const channel = "educationLive";
    const token = generateToken(channel);

    streamStatus = true;

    if (androidClient) {
        androidClient.send(JSON.stringify({
            action: "start",
            channel: channel,
            token: token
        }));
    }

    bot.sendMessage(msg.chat.id, "✅ Stream Started");
});

bot.onText(/\/stop_stream/, (msg) => {
    if (msg.chat.id.toString() !== ADMIN_ID) {
        return bot.sendMessage(msg.chat.id, "❌ Not Authorized");
    }

    streamStatus = false;

    if (androidClient) {
        androidClient.send(JSON.stringify({
            action: "stop"
        }));
    }

    bot.sendMessage(msg.chat.id, "🛑 Stream Stopped");
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});