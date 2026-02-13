// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockIdentityRegistry
/// @notice Test-only registry that mimics ownerOf checks for registered agent ids.
contract MockIdentityRegistry {
    mapping(uint256 => address) private _owners;
    mapping(uint256 => string) private _agentUris;
    uint256 private _nextAgentId;

    error TokenDoesNotExist(uint256 tokenId);
    error InvalidAgentURI();

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI);

    function setOwner(uint256 tokenId, address owner) external {
        _owners[tokenId] = owner;
    }

    function register(string calldata registrationURI) external returns (uint256 agentId) {
        if (bytes(registrationURI).length == 0) {
            revert InvalidAgentURI();
        }

        agentId = ++_nextAgentId;
        _owners[agentId] = msg.sender;
        _agentUris[agentId] = registrationURI;

        emit AgentRegistered(agentId, msg.sender, registrationURI);
    }

    function agentURI(uint256 tokenId) external view returns (string memory) {
        if (_owners[tokenId] == address(0)) {
            revert TokenDoesNotExist(tokenId);
        }
        return _agentUris[tokenId];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        if (owner == address(0)) {
            revert TokenDoesNotExist(tokenId);
        }
        return owner;
    }
}
