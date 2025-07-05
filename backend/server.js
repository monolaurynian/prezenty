const express = require("express");
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let gifts = [];
let recipients = [];

app.get("/api/gifts", (req, res) => res.json(gifts));
app.post("/api/gifts", (req, res) => {
  const gift = { id: Date.now(), ...req.body };
  gifts.push(gift);
  res.status(201).json(gift);
});
app.patch("/api/gifts/:id", (req, res) => {
  const gift = gifts.find(g => g.id == req.params.id);
  if (gift) {
    Object.assign(gift, req.body);
    res.json(gift);
  } else {
    res.status(404).send("Not found");
  }
});
app.delete("/api/gifts/:id", (req, res) => {
  gifts = gifts.filter(g => g.id != req.params.id);
  res.status(204).send();
});

app.get("/api/recipients", (req, res) => res.json(recipients));
app.post("/api/recipients", (req, res) => {
  const recipient = req.body;
  recipients.push(recipient);
  res.status(201).json(recipient);
});

app.listen(PORT, () => console.log("Server running on port", PORT));
