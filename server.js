import express from "express";
import { GET as scrapeFixtures } from "./scrape-fixtures/route.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/scrape-fixtures", async (req, res) => {
  const response = await scrapeFixtures(req);
  const text = await response.text();
  res.status(response.status).json(JSON.parse(text));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
