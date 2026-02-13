// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Minimal interface for validating registered ERC-8004 agents by token ownership
interface IERC8004ReputationRegistry {
    /// @notice Returns owner address for a registered agent token id
    function ownerOf(uint256 tokenId) external view returns (address);
}
