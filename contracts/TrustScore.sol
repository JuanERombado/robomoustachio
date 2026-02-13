// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC8004ReputationRegistry} from "./interfaces/IERC8004ReputationRegistry.sol";

/// @title TrustScore
/// @notice Stores and serves precomputed reputation scores for ERC-8004 agents.
/// @dev Scores are updated by an authorized off-chain updater.
contract TrustScore is Ownable {
    uint256 public constant MAX_SCORE = 1_000;

    struct ScoreRecord {
        uint256 score;
        uint256 totalFeedback;
        uint256 positiveFeedback;
        uint256 lastUpdated;
        bool exists;
    }

    mapping(uint256 agentId => ScoreRecord) private _scores;

    address public updater;
    uint256 public queryFee;
    IERC8004ReputationRegistry public identityRegistry;

    error NotUpdater(address caller);
    error ZeroAddress();
    error InvalidScore(uint256 score);
    error InvalidFeedbackCounts(uint256 totalFeedback, uint256 positiveFeedback);
    error AgentNotRegistered(uint256 agentId);
    error ArrayLengthMismatch();
    error ScoreNotFound(uint256 agentId);
    error InsufficientFee(uint256 sent, uint256 required);
    error WithdrawFailed();

    event ScoreUpdated(uint256 indexed agentId, uint256 score, uint256 timestamp);
    event ScoreQueried(uint256 indexed agentId, address indexed querier);
    event UpdaterSet(address indexed updater);
    event FeeSet(uint256 fee);
    event IdentityRegistrySet(address indexed identityRegistry);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyUpdater() {
        if (msg.sender != updater) {
            revert NotUpdater(msg.sender);
        }
        _;
    }

    /// @param initialOwner Owner account with administrative permissions
    /// @param identityRegistry_ ERC-8004 identity/reputation registry used to validate agent ids
    /// @param updater_ Authorized score updater address
    /// @param queryFee_ Fee charged for paid query endpoints
    constructor(address initialOwner, address identityRegistry_, address updater_, uint256 queryFee_) Ownable(initialOwner) {
        if (initialOwner == address(0) || identityRegistry_ == address(0) || updater_ == address(0)) {
            revert ZeroAddress();
        }
        identityRegistry = IERC8004ReputationRegistry(identityRegistry_);
        updater = updater_;
        queryFee = queryFee_;
    }

    /// @notice Returns current trust score (0-1000) for an agent id.
    function getScore(uint256 agentId) external view returns (uint256 score) {
        ScoreRecord storage record = _scores[agentId];
        if (!record.exists) {
            revert ScoreNotFound(agentId);
        }
        return record.score;
    }

    /// @notice Returns full score record for an agent id.
    function getDetailedReport(uint256 agentId) external view returns (ScoreRecord memory) {
        ScoreRecord storage record = _scores[agentId];
        if (!record.exists) {
            revert ScoreNotFound(agentId);
        }
        return record;
    }

    /// @notice Paid query path that emits a query event for analytics/accounting.
    function getDetailedReportPaid(uint256 agentId) external payable returns (ScoreRecord memory) {
        if (msg.value < queryFee) {
            revert InsufficientFee(msg.value, queryFee);
        }

        ScoreRecord storage record = _scores[agentId];
        if (!record.exists) {
            revert ScoreNotFound(agentId);
        }

        emit ScoreQueried(agentId, msg.sender);
        return record;
    }

    /// @notice Updates one agent score. Restricted to updater.
    function updateScore(uint256 agentId, uint256 newScore, uint256 totalFb, uint256 posFb) external onlyUpdater {
        _validateAndUpdate(agentId, newScore, totalFb, posFb);
    }

    /// @notice Batch updates multiple agent scores in one transaction.
    function batchUpdateScores(
        uint256[] calldata agentIds,
        uint256[] calldata scores,
        uint256[] calldata totals,
        uint256[] calldata positives
    ) external onlyUpdater {
        uint256 length = agentIds.length;
        if (length != scores.length || length != totals.length || length != positives.length) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < length; ++i) {
            _validateAndUpdate(agentIds[i], scores[i], totals[i], positives[i]);
        }
    }

    /// @notice Sets authorized updater.
    function setUpdater(address newUpdater) external onlyOwner {
        if (newUpdater == address(0)) {
            revert ZeroAddress();
        }
        updater = newUpdater;
        emit UpdaterSet(newUpdater);
    }

    /// @notice Sets paid query fee in wei.
    function setFee(uint256 newFee) external onlyOwner {
        queryFee = newFee;
        emit FeeSet(newFee);
    }

    /// @notice Sets registry used for agent validation.
    function setIdentityRegistry(address newRegistry) external onlyOwner {
        if (newRegistry == address(0)) {
            revert ZeroAddress();
        }
        identityRegistry = IERC8004ReputationRegistry(newRegistry);
        emit IdentityRegistrySet(newRegistry);
    }

    /// @notice Withdraws collected query fees to owner.
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool ok, ) = owner().call{value: balance}("");
        if (!ok) {
            revert WithdrawFailed();
        }
        emit Withdrawn(owner(), balance);
    }

    function _validateAndUpdate(uint256 agentId, uint256 newScore, uint256 totalFb, uint256 posFb) internal {
        if (newScore > MAX_SCORE) {
            revert InvalidScore(newScore);
        }
        if (posFb > totalFb) {
            revert InvalidFeedbackCounts(totalFb, posFb);
        }

        _assertRegistered(agentId);

        _scores[agentId] = ScoreRecord({
            score: newScore,
            totalFeedback: totalFb,
            positiveFeedback: posFb,
            lastUpdated: block.timestamp,
            exists: true
        });

        emit ScoreUpdated(agentId, newScore, block.timestamp);
    }

    function _assertRegistered(uint256 agentId) internal view {
        try identityRegistry.ownerOf(agentId) returns (address ownerAddress) {
            if (ownerAddress == address(0)) {
                revert AgentNotRegistered(agentId);
            }
        } catch {
            revert AgentNotRegistered(agentId);
        }
    }
}
