// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MahjongTable} from "../MahjongTable.sol";

/// @notice Implementasi V2 untuk menguji jalur upgrade UUPS.
///         Menambahkan satu variabel storage baru (di bawah __gap) + fungsi baru,
///         tanpa mengubah layout storage lama.
contract MahjongTableV2 is MahjongTable {
    /// @dev Variabel baru — aman karena ditambahkan di akhir layout.
    string public note;

    function setNote(string calldata _note) external onlyOwner {
        note = _note;
    }

    function version() external pure returns (string memory) {
        return "v2";
    }
}
