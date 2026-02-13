"use strict";

const UINT256_MAX = (1n << 256n) - 1n;

function parseAgentIdParam(rawAgentId) {
  if (typeof rawAgentId !== "string" || rawAgentId.length === 0) {
    throw new Error("agentId is required");
  }

  if (!/^\d+$/.test(rawAgentId)) {
    throw new Error("agentId must be a base-10 unsigned integer");
  }

  const agentId = BigInt(rawAgentId);
  if (agentId > UINT256_MAX) {
    throw new Error("agentId exceeds uint256 range");
  }

  return agentId;
}

function validateAgentIdParam(req, res, next) {
  try {
    req.agentId = parseAgentIdParam(req.params.agentId);
    return next();
  } catch (error) {
    return res.status(400).json({
      error: "Invalid agentId",
      details: error.message,
    });
  }
}

module.exports = {
  UINT256_MAX,
  parseAgentIdParam,
  validateAgentIdParam,
};
