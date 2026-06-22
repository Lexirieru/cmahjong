// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MahjongTable} from "../MahjongTable.sol";

/// @notice V2 implementation to test the UUPS upgrade path.
///         Adds one new storage variable (below __gap) + a new function,
///         without changing the existing storage layout.
contract MahjongTableV2 is MahjongTable {
    /// @dev New variable — safe because it is appended at the end of the layout.
    string public note;

    function setNote(string calldata _note) external onlyOwner {
        note = _note;
    }

    function version() external pure returns (string memory) {
        return "v2";
    }
}
