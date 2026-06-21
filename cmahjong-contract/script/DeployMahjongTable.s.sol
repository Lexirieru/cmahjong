// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MahjongTable} from "../src/MahjongTable.sol";

/// @notice Deploy MahjongTable.
/// Env yang dibaca:
///   PRIVATE_KEY     — deployer (sekaligus owner/house default).
///   STABLE_TOKEN    — alamat token buy-in (cUSD). Default = cUSD mainnet bila tak diset.
///   RAKE_BPS        — house cut dalam bps (opsional, default 300 = 3%).
///
/// Contoh (Alfajores):
///   forge script script/DeployMahjongTable.s.sol --rpc-url alfajores --broadcast --verify
contract DeployMahjongTable is Script {
    // cUSD: Celo mainnet & Alfajores testnet
    address constant CUSD_MAINNET = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address constant CUSD_ALFAJORES = 0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1;

    function run() external returns (MahjongTable mahjong) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(pk);

        address stable = vm.envOr("STABLE_TOKEN", CUSD_MAINNET);
        uint16 rakeBps = uint16(vm.envOr("RAKE_BPS", uint256(300)));

        vm.startBroadcast(pk);
        mahjong = new MahjongTable(IERC20(stable), owner, rakeBps);
        vm.stopBroadcast();

        console.log("MahjongTable:", address(mahjong));
        console.log("token:", stable);
        console.log("owner:", owner);
        console.log("rakeBps:", rakeBps);
    }
}
