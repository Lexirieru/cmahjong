// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Token ERC20 sederhana untuk pengujian (mensimulasikan cUSD).
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock cUSD", "mcUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
