import { startMockGoogleSheets } from "./mock-google-sheets.mjs";

process.env.GOOGLE_SHEETS_ENDPOINT = await startMockGoogleSheets();
process.argv = [process.argv[0], "next", "start", "--hostname", "127.0.0.1", "--port", "3100"];
await import("next/dist/bin/next");
