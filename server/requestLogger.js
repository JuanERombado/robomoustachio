"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_LOG_FILE = path.join(__dirname, "logs", "requests.log");

function extractAgentIdFromPath(pathname) {
  if (typeof pathname !== "string") {
    return null;
  }
  const match = pathname.match(/^\/(?:score|report)\/([^/?#]+)/);
  return match ? match[1] : null;
}

function determinePaymentStatus(req, res) {
  if (res.locals && typeof res.locals.paymentStatus === "string") {
    return res.locals.paymentStatus;
  }
  if (res.statusCode === 402) {
    return "payment_required";
  }

  const rawStatus = req.headers["x-payment-status"];
  if (typeof rawStatus === "string" && rawStatus.length > 0) {
    return `header_${rawStatus.toLowerCase()}`;
  }

  if (/^\/(?:score|report)\//.test(req.path || "")) {
    return "unknown_paid_route";
  }
  return "free";
}

function createRequestLoggerMiddleware(options = {}) {
  const logFilePath = path.resolve(options.logFilePath || process.env.REQUEST_LOG_FILE || DEFAULT_LOG_FILE);
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  const logStream = fs.createWriteStream(logFilePath, { flags: "a", encoding: "utf8" });

  logStream.on("error", (error) => {
    console.error(`[request-logger] stream error: ${error.message}`);
  });

  return function requestLogger(req, res, next) {
    const startedAt = process.hrtime.bigint();
    const requestTimestamp = new Date().toISOString();

    res.on("finish", () => {
      const finishedAt = process.hrtime.bigint();
      const responseTimeMs = Number(finishedAt - startedAt) / 1_000_000;
      const agentId = req.params?.agentId || extractAgentIdFromPath(req.path || req.originalUrl || "");

      const line = {
        timestamp: requestTimestamp,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        agentId: agentId || null,
        paymentStatus: determinePaymentStatus(req, res),
        responseTimeMs: Number(responseTimeMs.toFixed(3)),
      };

      logStream.write(`${JSON.stringify(line)}\n`);
    });

    next();
  };
}

module.exports = {
  DEFAULT_LOG_FILE,
  createRequestLoggerMiddleware,
};
