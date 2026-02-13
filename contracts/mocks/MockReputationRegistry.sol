// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockReputationRegistry
/// @notice Local/test mock that emits ERC-8004-style feedback events.
/// @dev Event field layout matches the EIP-8004 Reputation Registry feedback event signature.
contract MockReputationRegistry {
    struct FeedbackInput {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        string endpoint;
        string feedbackURI;
        bytes32 feedbackHash;
    }

    mapping(uint256 => address) private _owners;
    mapping(uint256 => mapping(address => uint64)) private _feedbackCountByClient;

    error AgentNotRegistered(uint256 agentId);
    error ZeroAddress();
    error InvalidValueDecimals(uint8 valueDecimals);

    event FeedbackPosted(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );

    function setAgentOwner(uint256 agentId, address owner) external {
        if (owner == address(0)) {
            revert ZeroAddress();
        }
        _owners[agentId] = owner;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        address owner = _owners[agentId];
        if (owner == address(0)) {
            revert AgentNotRegistered(agentId);
        }
        return owner;
    }

    function postFeedback(
        uint256 agentId,
        FeedbackInput calldata input
    ) external {
        if (_owners[agentId] == address(0)) {
            revert AgentNotRegistered(agentId);
        }
        if (input.valueDecimals > 18) {
            revert InvalidValueDecimals(input.valueDecimals);
        }

        uint64 feedbackIndex = _feedbackCountByClient[agentId][msg.sender] + 1;
        _feedbackCountByClient[agentId][msg.sender] = feedbackIndex;

        _emitFeedbackPosted(agentId, msg.sender, feedbackIndex, input);
    }

    function _emitFeedbackPosted(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex,
        FeedbackInput calldata input
    ) internal {
        emit FeedbackPosted(
            agentId,
            clientAddress,
            feedbackIndex,
            input.value,
            input.valueDecimals,
            input.tag1,
            input.tag1,
            input.tag2,
            input.endpoint,
            input.feedbackURI,
            input.feedbackHash
        );
    }
}
