"use strict";

const { formatUsdPrice } = require("./registration");

function routeToRegex(routePath) {
  return new RegExp(
    `^${routePath
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:([A-Za-z0-9_]+)/g, "[^/]+")}$`
  );
}

function buildPaidRoutes(routeConfig) {
  return Object.entries(routeConfig || {}).map(([key, config]) => {
    const [method, ...pathParts] = key.trim().split(" ");
    const routePath = pathParts.join(" ").trim();
    return {
      key,
      method: method.toUpperCase(),
      routePath,
      regex: routeToRegex(routePath),
      config: {
        ...config,
        price: formatUsdPrice(config.price),
      },
    };
  });
}

function matchPaidRoute(req, paidRoutes) {
  const method = req.method.toUpperCase();
  const pathname = req.path;
  return paidRoutes.find((route) => route.method === method && route.regex.test(pathname));
}

function extractPaymentHeaders(req) {
  const relevant = {};
  for (const [key, value] of Object.entries(req.headers || {})) {
    const lower = key.toLowerCase();
    if (
      lower.startsWith("x-payment") ||
      lower.startsWith("x402") ||
      lower === "payment" ||
      lower === "authorization"
    ) {
      relevant[lower] = Array.isArray(value) ? value.join(",") : String(value);
    }
  }
  return relevant;
}

function hasPaymentProof(headers) {
  if (!headers || typeof headers !== "object") {
    return false;
  }

  const status = `${headers["x-payment-status"] || ""}`.toLowerCase();
  return Boolean(
    headers["x-payment"] ||
      headers["x-payment-proof"] ||
      headers["x402-payment"] ||
      headers["x402-proof"] ||
      headers.authorization ||
      status === "paid"
  );
}

function createStubPaymentMiddleware(options = {}) {
  const paidRoutes = buildPaidRoutes(options.routeConfig);
  const enforceStubPayment = String(options.enforceStubPayment || "false").toLowerCase() === "true";

  const middleware = function stubPaymentMiddleware(req, res, next) {
    const matchedRoute = matchPaidRoute(req, paidRoutes);
    if (!matchedRoute) {
      if (!res.locals.paymentStatus) {
        res.locals.paymentStatus = "free";
      }
      return next();
    }

    const paymentHeaders = extractPaymentHeaders(req);
    const paid = hasPaymentProof(paymentHeaders);
    res.locals.paymentStatus = paid ? "paid_stub" : "unpaid_stub";

    console.log(
      `[x402-stub] ${req.method} ${req.path} route=${matchedRoute.key} paid=${paid} headers=${JSON.stringify(
        paymentHeaders
      )}`
    );

    if (!paid && enforceStubPayment) {
      return res.status(402).json({
        error: "Payment required (stub middleware)",
        route: matchedRoute.key,
        price: matchedRoute.config.price,
        network: matchedRoute.config.network || "base",
        description: matchedRoute.config.description || "",
      });
    }

    return next();
  };

  return {
    mode: "stub",
    usingRealMiddleware: false,
    reason: "Using local x402 stub middleware",
    middleware,
  };
}

function getRealPaymentMiddlewareFactory() {
  const candidates = [
    () => {
      const mod = require("@coinbase/x402");
      return mod.paymentMiddleware;
    },
    () => {
      const mod = require("@coinbase/x402/express");
      return mod.paymentMiddleware || mod.default;
    },
    () => {
      const mod = require("@coinbase/x402-express");
      return mod.paymentMiddleware || mod.default;
    },
    () => {
      const mod = require("@x402/express");
      return mod.paymentMiddleware || mod.default;
    },
  ];

  for (const getFactory of candidates) {
    try {
      const factory = getFactory();
      if (typeof factory === "function") {
        return factory;
      }
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function createPaymentMiddleware(options = {}) {
  const routeConfig = options.routeConfig || {};
  const mode = String(options.mode || process.env.X402_MODE || "auto").toLowerCase();
  const shouldTryReal = mode === "real" || mode === "auto";

  if (shouldTryReal) {
    const paymentMiddlewareFactory = getRealPaymentMiddlewareFactory();
    if (paymentMiddlewareFactory) {
      try {
        const realMiddleware = paymentMiddlewareFactory(routeConfig);
        if (typeof realMiddleware === "function") {
          return {
            mode: "real",
            usingRealMiddleware: true,
            reason: "Using @coinbase/x402 middleware",
            middleware: (req, res, next) => {
              if (!res.locals.paymentStatus) {
                res.locals.paymentStatus = "x402_pending";
              }
              return realMiddleware(req, res, next);
            },
          };
        }
      } catch (error) {
        if (mode === "real") {
          throw error;
        }
        return {
          ...createStubPaymentMiddleware(options),
          reason: `Fell back to stub middleware: ${error.message}`,
        };
      }
    }

    if (mode === "real") {
      throw new Error("X402 middleware requested in real mode but no compatible factory was found");
    }

    return {
      ...createStubPaymentMiddleware(options),
      reason: "Fell back to stub middleware: no compatible x402 express middleware factory found",
    };
  }

  return createStubPaymentMiddleware(options);
}

module.exports = {
  createPaymentMiddleware,
  createStubPaymentMiddleware,
  extractPaymentHeaders,
  hasPaymentProof,
};
