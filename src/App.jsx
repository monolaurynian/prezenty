// backend/server.js

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

// In-memory DB replacement (or use SQLite/Postgres via Coolify DB service)
let recipients = [];
let gifts = [];

app.get("/api/recipients", (req, res) => {
  res.json(recipients);
});

app.post("/api/recipients", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  recipients.push({ name });
  res.status(201).json({ success: true });
});

app.get("/api/gifts", (req, res) => {
  res.json(gifts);
});

app.post("/api/gifts", (req, res) => {
  const { gift, recipient, comments } = req.body;
  if (!gift || !recipient) return res.status(400).json({ error: "Gift and recipient required" });
  const newGift = {
    id: uuidv4(),
    gift,
    recipient,
    comments,
    checked: false,
  };
  gifts.push(newGift);
  res.status(201).json(newGift);
});

app.patch("/api/gifts/:id", (req, res) => {
  const { id } = req.params;
  const { checked } = req.body;
  const gift = gifts.find(g => g.id === id);
  if (!gift) return res.status(404).json({ error: "Not found" });
  gift.checked = checked;
  res.json({ success: true });
});

app.delete("/api/gifts/:id", (req, res) => {
  const { id } = req.params;
  gifts = gifts.filter(g => g.id !== id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
