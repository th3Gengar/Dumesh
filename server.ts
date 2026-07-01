import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

// -------------------------------------------------------------
// Emergency File-Backed Local Database for Offline/LAN Mode
// -------------------------------------------------------------
const DB_FILE = path.join(process.cwd(), "local_db.json");

interface LocalDB {
  users: Record<string, any>;
  groups: Record<string, any>;
  groupMembers: Record<string, any>; // key: "groupId_userId"
  messages: Record<string, any[]>;
  allowedEmails: Record<string, any>;
  telegramChannels: Record<string, any>;
  settings: {
    allowSelfAuthInEmergency: boolean; // humanitarian override to skip whitelist in disasters
  };
}

let dbState: LocalDB = {
  users: {},
  groups: {},
  groupMembers: {},
  messages: {},
  allowedEmails: {
    "arshiashokoufezamir@gmail.com": {
      id: "arshiashokoufezamir@gmail.com",
      email: "arshiashokoufezamir@gmail.com",
      displayName: "Project Administrator",
      assignedGroups: [],
      createdAt: new Date().toISOString(),
    }
  },
  telegramChannels: {
    "durov": {
      id: "durov",
      displayName: "Du Rove Updates",
      description: "Official channel announcements",
      createdAt: new Date().toISOString(),
    }
  },
  settings: {
    allowSelfAuthInEmergency: true, // Default to true so people can self-communicate in a blackout
  },
};

// Guard reads and writes synchronously or with try/catch to maintain resilience
function loadLocalDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      // Deep merge settings and collections to avoid undefined traps
      dbState = {
        users: parsed.users || {},
        groups: parsed.groups || {},
        groupMembers: parsed.groupMembers || {},
        messages: parsed.messages || {},
        allowedEmails: parsed.allowedEmails || {},
        telegramChannels: parsed.telegramChannels || {},
        settings: {
          allowSelfAuthInEmergency: true,
          ...(parsed.settings || {}),
        },
      };
      
      // Ensure admin remains whitelisted
      if (!dbState.allowedEmails["arshiashokoufezamir@gmail.com"]) {
        dbState.allowedEmails["arshiashokoufezamir@gmail.com"] = {
          id: "arshiashokoufezamir@gmail.com",
          email: "arshiashokoufezamir@gmail.com",
          displayName: "Project Administrator",
          assignedGroups: [],
          createdAt: new Date().toISOString(),
        };
      }
      console.log("[DB] Loaded local offline database successfully containing", Object.keys(dbState.users).length, "users.");
    } else {
      saveLocalDatabase();
    }
  } catch (err) {
    console.error("[DB] Failed to load local database, falling back to memory.", err);
  }
}

function saveLocalDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbState, null, 2), "utf-8");
  } catch (err) {
    console.error("[DB] Save error:", err);
  }
}

// Perform initial load
loadLocalDatabase();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // -------------------------------------------------------------
  // API Route: Safe Server-side Telegram scraper
  // -------------------------------------------------------------
  app.get("/api/telegram/fetch", async (req, res) => {
    const channelName = req.query.channel as string;
    if (!channelName) {
      res.status(400).json({ error: "Channel name parameter 'channel' is required" });
      return;
    }

    const sanitized = channelName.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "");
    if (!sanitized) {
      res.status(400).json({ error: "Invalid Telegram channel name" });
      return;
    }

    try {
      const url = `https://t.me/s/${sanitized}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      });

      if (!response.ok) {
        res.status(response.status).json({ error: `Failed to fetch Telegram channel (status: ${response.status})` });
        return;
      }

      const html = await response.text();
      const posts: Array<{
        id: string;
        postId: string;
        text: string;
        date: string;
        mediaUrl?: string;
      }> = [];

      const postBlockRegex = /<div class="[^"]*?tgme_widget_message\s+[^"]*?"[^>]*?data-post="([^"]+)"[^>]*?>([\s\S]*?)(?=(?:<div class="[^"]*?tgme_widget_message\s+[^"]*?"[^>]*?data-post=)|<div class="tgme_footer_wrap|$)/g;

      let match;
      while ((match = postBlockRegex.exec(html)) !== null) {
        const fullPostId = match[1];
        const postHtml = match[2];
        const postId = fullPostId.split("/").pop() || "";

        const textMatch = postHtml.match(/class="[^"]*?tgme_widget_message_text\b[^"]*?"[^>]*?>([\s\S]*?)<\/div>/);
        let text = textMatch ? textMatch[1] : "";
        text = text
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .trim();

        const dateMatch = postHtml.match(/<time[^>]*?datetime="([^"]+)"/);
        const date = dateMatch ? dateMatch[1] : new Date().toISOString();

        const bgMatch = postHtml.match(/class="[^"]*?tgme_widget_message_photo_wrap\b[^"]*?"[^>]*?background-image\s*:\s*url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/);
        const mediaUrl = bgMatch ? bgMatch[1] : undefined;

        if (text || mediaUrl) {
          posts.push({
            id: fullPostId,
            postId,
            text,
            date,
            mediaUrl,
          });
        }
      }

      posts.sort((a, b) => b.postId.localeCompare(a.postId, undefined, { numeric: true }));

      res.json({
        channel: sanitized,
        posts: posts.slice(0, 20)
      });
    } catch (e: any) {
      res.status(500).json({ error: `Internal scraper exception: ${e.message}` });
    }
  });

  // -------------------------------------------------------------
  // LOCAL MESH NETWORK MODE ENDPOINTS (OFFLINE BLACKOUT CAPABLE)
  // -------------------------------------------------------------

  // Settings
  app.get("/api/local/settings", (req, res) => {
    res.json(dbState.settings);
  });

  app.post("/api/local/settings", (req, res) => {
    const { allowSelfAuthInEmergency } = req.body;
    if (typeof allowSelfAuthInEmergency === "boolean") {
      dbState.settings.allowSelfAuthInEmergency = allowSelfAuthInEmergency;
      saveLocalDatabase();
    }
    res.json(dbState.settings);
  });

  // Whitelist/Allowed Emails Local Sync
  app.get("/api/local/allowed_emails", (req, res) => {
    res.json(Object.values(dbState.allowedEmails));
  });

  app.post("/api/local/allowed_emails", (req, res) => {
    const { email, displayName, assignedGroups } = req.body;
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    dbState.allowedEmails[cleanEmail] = {
      id: cleanEmail,
      email: cleanEmail,
      displayName: displayName || cleanEmail.split("@")[0],
      assignedGroups: assignedGroups || [],
      createdAt: new Date().toISOString(),
    };
    saveLocalDatabase();
    res.json(dbState.allowedEmails[cleanEmail]);
  });

  app.delete("/api/local/allowed_emails/:email", (req, res) => {
    const cleanEmail = req.params.email.trim().toLowerCase();
    delete dbState.allowedEmails[cleanEmail];
    saveLocalDatabase();
    res.json({ success: true });
  });

  // Local User Profile / Key Handshakes registration
  app.get("/api/local/users", (req, res) => {
    res.json(Object.values(dbState.users));
  });

  app.get("/api/local/users/:uid", (req, res) => {
    const user = dbState.users[req.params.uid];
    if (!user) {
      res.status(404).json({ error: "User profile not found in local registry" });
      return;
    }
    res.json(user);
  });

  app.post("/api/local/users", (req, res) => {
    const { uid, email, displayName, publicKey } = req.body;
    if (!uid || !email || !displayName || !publicKey) {
      res.status(400).json({ error: "Missing required profile parameters" });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    
    // Whitelist check
    const isWhitelisted = dbState.allowedEmails[cleanEmail] || cleanEmail === "arshiashokoufezamir@gmail.com";
    if (!isWhitelisted && !dbState.settings.allowSelfAuthInEmergency) {
      res.status(403).json({ error: "Access Denied: Email not whitelisted by administrator" });
      return;
    }

    dbState.users[uid] = {
      id: uid,
      email: cleanEmail,
      displayName,
      publicKey,
      createdAt: new Date().toISOString(),
    };
    saveLocalDatabase();
    res.json(dbState.users[uid]);
  });

  // Local Groups
  app.get("/api/local/groups", (req, res) => {
    res.json(Object.values(dbState.groups));
  });

  app.post("/api/local/groups", (req, res) => {
    const { id, name, description, createdBy, password } = req.body;
    if (!id || !name || !createdBy) {
      res.status(400).json({ error: "Missing group parameters" });
      return;
    }

    dbState.groups[id] = {
      id,
      name,
      description: description || "",
      password: password || "",
      createdBy,
      createdAt: new Date().toISOString(),
    };
    saveLocalDatabase();
    res.json(dbState.groups[id]);
  });

  // Group Members key bindings (encryptedGroupKey mapping)
  app.get("/api/local/groups/:groupId/members", (req, res) => {
    const result = Object.values(dbState.groupMembers).filter(
      (m: any) => m.groupId === req.params.groupId
    );
    res.json(result);
  });

  app.get("/api/local/groups/:groupId/members/:userId", (req, res) => {
    const key = `${req.params.groupId}_${req.params.userId}`;
    const member = dbState.groupMembers[key];
    if (!member) {
      res.json(null);
    } else {
      res.json(member);
    }
  });

  app.post("/api/local/groups/:groupId/members/:userId", (req, res) => {
    const { groupId, userId } = req.params;
    const { encryptedGroupKey, displayName, email } = req.body;
    
    if (!encryptedGroupKey) {
      res.status(400).json({ error: "encryptedGroupKey is required" });
      return;
    }

    const key = `${groupId}_${userId}`;
    dbState.groupMembers[key] = {
      groupId,
      userId,
      email: email?.toLowerCase() || "",
      displayName: displayName || "",
      encryptedGroupKey,
      createdAt: new Date().toISOString(),
    };
    saveLocalDatabase();
    res.json(dbState.groupMembers[key]);
  });

  // Local Messaging
  app.get("/api/local/chats/:chatId/messages", (req, res) => {
    const chatId = req.params.chatId;
    const list = dbState.messages[chatId] || [];
    res.json(list);
  });

  app.post("/api/local/chats/:chatId/messages", (req, res) => {
    const chatId = req.params.chatId;
    const { id, senderId, senderName, encryptedPayload, encryptedSymmetricKeys, isGroup } = req.body;

    if (!id || !senderId || !senderName || !encryptedPayload) {
      res.status(400).json({ error: "Malformed message fields." });
      return;
    }

    if (!dbState.messages[chatId]) {
      dbState.messages[chatId] = [];
    }

    const newMessage = {
      id,
      senderId,
      senderName,
      encryptedPayload,
      encryptedSymmetricKeys: encryptedSymmetricKeys || null,
      isGroup: !!isGroup,
      createdAt: new Date().toISOString(),
    };

    dbState.messages[chatId].push(newMessage);
    // Keep list reasonable (limit last 200 in blackout mode per room)
    if (dbState.messages[chatId].length > 200) {
      dbState.messages[chatId] = dbState.messages[chatId].slice(-200);
    }

    saveLocalDatabase();
    res.json(newMessage);
  });

  // Local Telegram channels
  app.get("/api/local/telegram_channels", (req, res) => {
    res.json(Object.values(dbState.telegramChannels));
  });

  app.post("/api/local/telegram_channels", (req, res) => {
    const { id, displayName, description } = req.body;
    if (!id || !displayName) {
      res.status(400).json({ error: "Missing telegram parameters." });
      return;
    }
    dbState.telegramChannels[id] = {
      id,
      displayName,
      description,
      createdAt: new Date().toISOString(),
    };
    saveLocalDatabase();
    res.json(dbState.telegramChannels[id]);
  });

  app.delete("/api/local/telegram_channels/:id", (req, res) => {
    delete dbState.telegramChannels[req.params.id];
    saveLocalDatabase();
    res.json({ success: true });
  });

  // Serve static assets / Vite bundles
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
