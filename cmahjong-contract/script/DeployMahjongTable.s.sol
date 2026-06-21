// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MahjongTable} from "../src/MahjongTable.sol";

/// @notice Deploy MahjongTable (UUPS) ke Celo mainnet: implementation + ERC1967Proxy,
///         allowlist cUSD / USDC / USDT / CELO native via initialize().
///
/// Env yang dibaca:
///   PRIVATE_KEY — deployer (sekaligus owner/house & otoritas upgrade default).
///   RAKE_BPS    — house cut dalam bps (opsional, default 300 = 3%).
///
/// Jalankan (mainnet):
///   forge script script/DeployMahjongTable.s.sol --rpc-url celo --broadcast --verify
contract DeployMahjongTable is Script {
    // Token buy-in yang di-allowlist di Celo mainnet.
    address constant CUSD = 0x765DE816845861e75A25fCA122bb6898B8B1282a; // 18 desimal
    address constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C; // 6 desimal
    address constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e; // 6 desimal
    address constant NATIVE_CELO = address(0); // sentinel CELO native

    function run() external returns (address proxy, address implementation) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(pk);
        uint16 rakeBps = uint16(vm.envOr("RAKE_BPS", uint256(300)));

        address[] memory tokens = new address[](4);
        tokens[0] = CUSD;
        tokens[1] = USDC;
        tokens[2] = USDT;
        tokens[3] = NATIVE_CELO;

        bytes memory initData = abi.encodeCall(MahjongTable.initialize, (owner, rakeBps, tokens));

        vm.startBroadcast(pk);
        MahjongTable impl = new MahjongTable();
        ERC1967Proxy proxyContract = new ERC1967Proxy(address(impl), initData);
        vm.stopBroadcast();

        proxy = address(proxyContract);
        implementation = address(impl);

        console.log("MahjongTable proxy:         ", proxy);
        console.log("MahjongTable implementation:", implementation);
        console.log("owner:", owner);
        console.log("rakeBps:", rakeBps);
        console.log("allowlist: cUSD, USDC, USDT, CELO(native)");
    }
}
