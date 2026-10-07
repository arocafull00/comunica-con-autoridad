import { createServer } from "node:http";

// Local integration fixture. It never forwards data to the real spreadsheet.
export async function startMockGoogleSheets() {
  const submissions = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/submissions") {
      response.end(JSON.stringify([...submissions.values()]));
      return;
    }
    if (request.method !== "POST" || request.url !== "/exec") {
      response.writeHead(404).end(JSON.stringify({ success: false }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = Object.fromEntries(new URLSearchParams(body));
    const duplicate = submissions.has(data.submission_id);
    submissions.set(data.submission_id, data);
    response.end(JSON.stringify({ success: true, duplicate }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(3102, "127.0.0.1", resolve);
  });
  return "http://127.0.0.1:3102/exec";
}
