// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MahjongTable} from "../src/MahjongTable.sol";
import {MahjongTableV2} from "../src/mocks/MahjongTableV2.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract MahjongTableTest is Test {
    MahjongTable internal mahjong;
    MockERC20 internal token;

    address internal constant NATIVE = address(0);

    address internal owner = makeAddr("owner");
    address internal server;
    uint256 internal serverPk;
    address internal outsider = makeAddr("outsider");

    uint256[4] internal pks;
    address[4] internal players;

    uint256 internal constant BUY_IN = 5e18;
    uint256 internal constant START_BAL = 100e18;
    uint16 internal constant RAKE_BPS = 300; // 3%
    uint16[4] internal payoutBps = [uint16(5000), 3000, 1500, 500];

    function setUp() public {
        token = new MockERC20();

        address[] memory toks = new address[](2);
        toks[0] = address(token);
        toks[1] = NATIVE; // CELO native
        mahjong = _deployProxy(RAKE_BPS, toks);

        (server, serverPk) = makeAddrAndKey("server");

        for (uint256 i; i < 4; ++i) {
            (address a, uint256 k) = makeAddrAndKey(string.concat("player", vm.toString(i)));
            players[i] = a;
            pks[i] = k;
            token.mint(a, START_BAL);
            vm.deal(a, START_BAL); // saldo native untuk game CELO
            vm.prank(a);
            token.approve(address(mahjong), type(uint256).max);
        }
    }

    // ----------------------------------------------------------------- helpers

    /// @dev Deploy implementation + ERC1967Proxy lalu initialize (pola UUPS).
    function _deployProxy(uint16 rakeBps_, address[] memory toks) internal returns (MahjongTable) {
        MahjongTable impl = new MahjongTable();
        bytes memory data = abi.encodeCall(MahjongTable.initialize, (owner, rakeBps_, toks));
        return MahjongTable(payable(address(new ERC1967Proxy(address(impl), data))));
    }

    function _erc20Only() internal view returns (address[] memory toks) {
        toks = new address[](1);
        toks[0] = address(token);
    }

    function _createGame() internal returns (uint256 gameId) {
        gameId = mahjong.createGame(address(token), BUY_IN, server, payoutBps, 1 hours, 1 hours, 1 hours);
    }

    function _createNativeGame() internal returns (uint256 gameId) {
        gameId = mahjong.createGame(NATIVE, BUY_IN, server, payoutBps, 1 hours, 1 hours, 1 hours);
    }

    function _secret(uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("secret", i));
    }

    function _join(uint256 gameId, uint256 i) internal {
        bytes32 commitment = mahjong.commitmentOf(gameId, players[i], _secret(i));
        vm.prank(players[i]);
        mahjong.joinGame(gameId, commitment);
    }

    function _joinNative(uint256 gameId, uint256 i) internal {
        bytes32 commitment = mahjong.commitmentOf(gameId, players[i], _secret(i));
        vm.prank(players[i]);
        mahjong.joinGame{value: BUY_IN}(gameId, commitment);
    }

    function _joinAll(uint256 gameId) internal {
        for (uint256 i; i < 4; ++i) {
            _join(gameId, i);
        }
    }

    function _joinAllNative(uint256 gameId) internal {
        for (uint256 i; i < 4; ++i) {
            _joinNative(gameId, i);
        }
    }

    function _revealAll(uint256 gameId) internal {
        for (uint256 i; i < 4; ++i) {
            vm.prank(players[i]);
            mahjong.revealSeed(gameId, _secret(i));
        }
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signAll(uint256 gameId, address[4] memory ranking) internal view returns (bytes[4] memory sigs) {
        bytes32 digest = mahjong.resultDigest(gameId, ranking);
        for (uint256 i; i < 4; ++i) {
            sigs[i] = _sign(pks[i], digest);
        }
    }

    function _toPlaying(uint256 gameId) internal {
        _joinAll(gameId);
        _revealAll(gameId);
    }

    function _orderedRanking() internal view returns (address[4] memory) {
        return [players[0], players[1], players[2], players[3]];
    }

    // =========================================================== constructor

    function test_Constructor_SetsState() public view {
        assertEq(mahjong.owner(), owner);
        assertEq(mahjong.rakeBps(), RAKE_BPS);
        assertEq(mahjong.gameCount(), 0);
        assertTrue(mahjong.tokenAllowed(address(token)));
        assertTrue(mahjong.tokenAllowed(NATIVE));
        assertFalse(mahjong.tokenAllowed(outsider));
    }

    function test_RevertWhen_Initialize_RakeTooHigh() public {
        address[] memory toks = new address[](0);
        MahjongTable impl = new MahjongTable();
        bytes memory data = abi.encodeCall(MahjongTable.initialize, (owner, 1001, toks));
        vm.expectRevert(MahjongTable.RakeTooHigh.selector);
        new ERC1967Proxy(address(impl), data);
    }

    function test_RevertWhen_Initialize_Twice() public {
        address[] memory toks = _erc20Only();
        vm.expectRevert(); // InvalidInitialization
        mahjong.initialize(owner, RAKE_BPS, toks);
    }

    function test_RevertWhen_Implementation_InitializeDisabled() public {
        // implementasi mentah (bukan proxy) tak boleh di-initialize
        MahjongTable impl = new MahjongTable();
        address[] memory toks = _erc20Only();
        vm.expectRevert(); // InvalidInitialization (_disableInitializers)
        impl.initialize(owner, RAKE_BPS, toks);
    }

    // =============================================================== upgrade

    function test_UpgradeToV2_PreservesState() public {
        // bangun state: 1 game settled
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = _orderedRanking();
        mahjong.settle(gameId, ranking, _signAll(gameId, ranking));
        uint256 creditBefore = mahjong.creditOf(address(token), players[0]);
        uint256 countBefore = mahjong.gameCount();

        MahjongTableV2 v2 = new MahjongTableV2();
        vm.prank(owner);
        UUPSUpgradeable(address(mahjong)).upgradeToAndCall(address(v2), "");

        MahjongTableV2 upgraded = MahjongTableV2(payable(address(mahjong)));
        assertEq(upgraded.version(), "v2");
        // state lama terjaga melewati upgrade
        assertEq(upgraded.gameCount(), countBefore);
        assertEq(upgraded.creditOf(address(token), players[0]), creditBefore);
        assertEq(upgraded.owner(), owner);
        assertTrue(upgraded.tokenAllowed(NATIVE));

        // fungsi & storage baru berfungsi
        vm.prank(owner);
        upgraded.setNote("hello");
        assertEq(upgraded.note(), "hello");
    }

    function test_RevertWhen_Upgrade_NotOwner() public {
        MahjongTableV2 v2 = new MahjongTableV2();
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        UUPSUpgradeable(address(mahjong)).upgradeToAndCall(address(v2), "");
    }

    // ============================================================== allowlist

    function test_SetTokenAllowed_Toggle() public {
        address rando = makeAddr("randoToken");
        vm.prank(owner);
        mahjong.setTokenAllowed(rando, true);
        assertTrue(mahjong.tokenAllowed(rando));
        vm.prank(owner);
        mahjong.setTokenAllowed(rando, false);
        assertFalse(mahjong.tokenAllowed(rando));
    }

    function test_RevertWhen_SetTokenAllowed_NotOwner() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        mahjong.setTokenAllowed(outsider, true);
    }

    function test_RevertWhen_CreateGame_TokenNotAllowed() public {
        address rando = makeAddr("randoToken");
        vm.expectRevert(MahjongTable.TokenNotAllowed.selector);
        mahjong.createGame(rando, BUY_IN, server, payoutBps, 1 hours, 1 hours, 1 hours);
    }

    // ============================================================ createGame

    function test_CreateGame_IncrementsIdAndStores() public {
        uint256 id1 = _createGame();
        uint256 id2 = _createNativeGame();
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(mahjong.gameCount(), 2);

        MahjongTable.Game memory g1 = mahjong.getGame(id1);
        assertEq(g1.token, address(token));
        assertEq(g1.buyIn, BUY_IN);
        assertEq(g1.server, server);
        assertEq(uint256(g1.status), uint256(MahjongTable.Status.Open));
        assertEq(g1.commitDeadline, block.timestamp + 1 hours);

        assertEq(mahjong.getGame(id2).token, NATIVE);
    }

    function test_RevertWhen_CreateGame_ZeroBuyIn() public {
        vm.expectRevert(MahjongTable.InvalidBuyIn.selector);
        mahjong.createGame(address(token), 0, server, payoutBps, 1 hours, 1 hours, 1 hours);
    }

    function test_RevertWhen_CreateGame_ZeroServer() public {
        vm.expectRevert(MahjongTable.InvalidServer.selector);
        mahjong.createGame(address(token), BUY_IN, address(0), payoutBps, 1 hours, 1 hours, 1 hours);
    }

    function test_RevertWhen_CreateGame_BadPayoutSum() public {
        uint16[4] memory bad = [uint16(5000), 3000, 1500, 499]; // sum 9999
        vm.expectRevert(MahjongTable.InvalidPayoutWeights.selector);
        mahjong.createGame(address(token), BUY_IN, server, bad, 1 hours, 1 hours, 1 hours);
    }

    function test_RevertWhen_CreateGame_ZeroWindow() public {
        vm.expectRevert(MahjongTable.InvalidWindow.selector);
        mahjong.createGame(address(token), BUY_IN, server, payoutBps, 0, 1 hours, 1 hours);
        vm.expectRevert(MahjongTable.InvalidWindow.selector);
        mahjong.createGame(address(token), BUY_IN, server, payoutBps, 1 hours, 0, 1 hours);
        vm.expectRevert(MahjongTable.InvalidWindow.selector);
        mahjong.createGame(address(token), BUY_IN, server, payoutBps, 1 hours, 1 hours, 0);
    }

    // ====================================================== joinGame (ERC20)

    function test_JoinGame_EscrowsAndSeats() public {
        uint256 gameId = _createGame();
        _join(gameId, 0);
        assertEq(token.balanceOf(players[0]), START_BAL - BUY_IN);
        assertEq(token.balanceOf(address(mahjong)), BUY_IN);

        MahjongTable.Game memory g = mahjong.getGame(gameId);
        assertEq(g.joined, 1);
        assertEq(g.players[0], players[0]);
        assertEq(uint256(g.status), uint256(MahjongTable.Status.Open));
    }

    function test_JoinGame_FourthFillsAndOpensReveal() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        MahjongTable.Game memory g = mahjong.getGame(gameId);
        assertEq(g.joined, 4);
        assertEq(uint256(g.status), uint256(MahjongTable.Status.Revealing));
        assertEq(g.revealDeadline, block.timestamp + 1 hours);
        assertEq(token.balanceOf(address(mahjong)), BUY_IN * 4);
    }

    function test_RevertWhen_JoinGame_NonexistentGame() public {
        bytes32 c = mahjong.commitmentOf(999, players[0], _secret(0));
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.joinGame(999, c);
    }

    function test_RevertWhen_JoinGame_AfterCommitDeadline() public {
        uint256 gameId = _createGame();
        vm.warp(block.timestamp + 1 hours + 1);
        bytes32 c = mahjong.commitmentOf(gameId, players[0], _secret(0));
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.DeadlinePassed.selector);
        mahjong.joinGame(gameId, c);
    }

    function test_RevertWhen_JoinGame_AlreadyJoined() public {
        uint256 gameId = _createGame();
        _join(gameId, 0);
        bytes32 c = mahjong.commitmentOf(gameId, players[0], _secret(0));
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.AlreadyJoined.selector);
        mahjong.joinGame(gameId, c);
    }

    function test_RevertWhen_JoinGame_FifthPlayer() public {
        uint256 gameId = _createGame();
        _joinAll(gameId); // status -> Revealing
        bytes32 c = mahjong.commitmentOf(gameId, outsider, _secret(9));
        token.mint(outsider, START_BAL);
        vm.prank(outsider);
        token.approve(address(mahjong), type(uint256).max);
        vm.prank(outsider);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.joinGame(gameId, c);
    }

    function test_RevertWhen_JoinGame_NoAllowance() public {
        uint256 gameId = _createGame();
        address broke = makeAddr("broke");
        token.mint(broke, START_BAL); // punya saldo tapi tak approve
        bytes32 c = mahjong.commitmentOf(gameId, broke, _secret(0));
        vm.prank(broke);
        vm.expectRevert(); // ERC20InsufficientAllowance
        mahjong.joinGame(gameId, c);
    }

    function test_RevertWhen_JoinGame_ERC20WithNativeValue() public {
        uint256 gameId = _createGame();
        bytes32 c = mahjong.commitmentOf(gameId, players[0], _secret(0));
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.BadValue.selector);
        mahjong.joinGame{value: 1}(gameId, c); // game ERC20 tak boleh kirim native
    }

    // ===================================================== joinGame (native)

    function test_JoinGame_Native_EscrowsValue() public {
        uint256 gameId = _createNativeGame();
        _joinNative(gameId, 0);
        assertEq(players[0].balance, START_BAL - BUY_IN);
        assertEq(address(mahjong).balance, BUY_IN);
        assertEq(mahjong.getGame(gameId).joined, 1);
    }

    function test_RevertWhen_JoinGame_Native_WrongValue() public {
        uint256 gameId = _createNativeGame();
        bytes32 c = mahjong.commitmentOf(gameId, players[0], _secret(0));
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.BadValue.selector);
        mahjong.joinGame{value: BUY_IN - 1}(gameId, c);
    }

    function test_RevertWhen_JoinGame_Native_NoValue() public {
        uint256 gameId = _createNativeGame();
        bytes32 c = mahjong.commitmentOf(gameId, players[0], _secret(0));
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.BadValue.selector);
        mahjong.joinGame(gameId, c); // value 0 untuk game native -> revert
    }

    // ============================================================ revealSeed

    function test_RevealSeed_BuildsDeterministicSeed() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        _revealAll(gameId);

        bytes32 expected = keccak256(abi.encodePacked(_secret(0), _secret(1), _secret(2), _secret(3)));
        MahjongTable.Game memory g = mahjong.getGame(gameId);
        assertEq(g.seed, expected);
        assertEq(mahjong.getSeed(gameId), expected);
        assertEq(uint256(g.status), uint256(MahjongTable.Status.Playing));
        assertEq(g.settleDeadline, block.timestamp + 1 hours);
    }

    function test_RevealSeed_StaysRevealingUntilAll() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        for (uint256 i; i < 3; ++i) {
            vm.prank(players[i]);
            mahjong.revealSeed(gameId, _secret(i));
        }
        MahjongTable.Game memory g = mahjong.getGame(gameId);
        assertEq(uint256(g.status), uint256(MahjongTable.Status.Revealing));
        assertEq(g.revealedCount, 3);
        assertEq(g.seed, bytes32(0));
    }

    function test_RevertWhen_RevealSeed_BeforeFull() public {
        uint256 gameId = _createGame();
        _join(gameId, 0);
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.revealSeed(gameId, _secret(0));
    }

    function test_RevertWhen_RevealSeed_AfterDeadline() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.DeadlinePassed.selector);
        mahjong.revealSeed(gameId, _secret(0));
    }

    function test_RevertWhen_RevealSeed_Twice() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.prank(players[0]);
        mahjong.revealSeed(gameId, _secret(0));
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.AlreadyRevealed.selector);
        mahjong.revealSeed(gameId, _secret(0));
    }

    function test_RevertWhen_RevealSeed_NotAPlayer() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.prank(outsider);
        vm.expectRevert(MahjongTable.NotAPlayer.selector);
        mahjong.revealSeed(gameId, _secret(0));
    }

    function test_RevertWhen_RevealSeed_BadSecret() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.BadReveal.selector);
        mahjong.revealSeed(gameId, keccak256("wrong"));
    }

    function test_RevertWhen_RevealSeed_SecretOfAnotherPlayer() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.BadReveal.selector);
        mahjong.revealSeed(gameId, _secret(1));
    }

    // ================================================== settle (ERC20, credits)

    function test_Settle_CreditsUmaOkaAndConservesPot() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);

        address[4] memory ranking = _orderedRanking();
        mahjong.settle(gameId, ranking, _signAll(gameId, ranking));

        // pot=20e18, rake=0.6e18, distributable=19.4e18
        assertEq(mahjong.creditOf(address(token), players[0]), 9.7e18);
        assertEq(mahjong.creditOf(address(token), players[1]), 5.82e18);
        assertEq(mahjong.creditOf(address(token), players[2]), 2.91e18);
        assertEq(mahjong.creditOf(address(token), players[3]), 0.97e18);
        assertEq(mahjong.creditOf(address(token), owner), 0.6e18); // rake
        assertEq(uint256(mahjong.getGame(gameId).status), uint256(MahjongTable.Status.Settled));
        // konservasi: seluruh pot masih tertahan kontrak sebagai kredit
        assertEq(token.balanceOf(address(mahjong)), BUY_IN * 4);
    }

    function test_Settle_ThenWithdraw_ERC20() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = _orderedRanking();
        mahjong.settle(gameId, ranking, _signAll(gameId, ranking));

        uint256 before = token.balanceOf(players[0]);
        vm.prank(players[0]);
        mahjong.withdraw(address(token));
        assertEq(token.balanceOf(players[0]) - before, 9.7e18);
        assertEq(mahjong.creditOf(address(token), players[0]), 0);
    }

    function test_Settle_SignatureOrderIndependent() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);

        address[4] memory ranking = [players[1], players[3], players[0], players[2]];
        bytes32 digest = mahjong.resultDigest(gameId, ranking);
        bytes[4] memory sigs;
        sigs[0] = _sign(pks[2], digest);
        sigs[1] = _sign(pks[0], digest);
        sigs[2] = _sign(pks[3], digest);
        sigs[3] = _sign(pks[1], digest);

        mahjong.settle(gameId, ranking, sigs);
        assertEq(mahjong.creditOf(address(token), players[1]), 9.7e18); // juara 1
    }

    function test_RevertWhen_Settle_WrongStatus() public {
        uint256 gameId = _createGame();
        _joinAll(gameId); // masih Revealing
        address[4] memory ranking = _orderedRanking();
        bytes[4] memory sigs = _signAll(gameId, ranking);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.settle(gameId, ranking, sigs);
    }

    function test_RevertWhen_Settle_Twice() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = _orderedRanking();
        bytes[4] memory sigs = _signAll(gameId, ranking);
        mahjong.settle(gameId, ranking, sigs);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.settle(gameId, ranking, sigs);
    }

    function test_RevertWhen_Settle_DuplicateSigner() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = _orderedRanking();
        bytes32 digest = mahjong.resultDigest(gameId, ranking);
        bytes[4] memory sigs;
        sigs[0] = _sign(pks[0], digest);
        sigs[1] = _sign(pks[1], digest);
        sigs[2] = _sign(pks[2], digest);
        sigs[3] = _sign(pks[0], digest); // player0 dobel, player3 absen
        vm.expectRevert(MahjongTable.BadSignature.selector);
        mahjong.settle(gameId, ranking, sigs);
    }

    function test_RevertWhen_Settle_OutsiderSigner() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = _orderedRanking();
        (, uint256 randoPk) = makeAddrAndKey("randoSigner");
        bytes32 digest = mahjong.resultDigest(gameId, ranking);
        bytes[4] memory sigs;
        sigs[0] = _sign(pks[0], digest);
        sigs[1] = _sign(pks[1], digest);
        sigs[2] = _sign(pks[2], digest);
        sigs[3] = _sign(randoPk, digest);
        vm.expectRevert(MahjongTable.NotAPlayer.selector);
        mahjong.settle(gameId, ranking, sigs);
    }

    function test_RevertWhen_Settle_SignaturesOverDifferentRanking() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory rankingA = _orderedRanking();
        address[4] memory rankingB = [players[3], players[2], players[1], players[0]];
        bytes32 digestA = mahjong.resultDigest(gameId, rankingA);
        bytes[4] memory sigs;
        for (uint256 i; i < 4; ++i) {
            sigs[i] = _sign(pks[i], digestA);
        }
        vm.expectRevert(MahjongTable.NotAPlayer.selector);
        mahjong.settle(gameId, rankingB, sigs);
    }

    function test_RevertWhen_Settle_RankingNotPermutation() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = [players[0], players[0], players[2], players[3]];
        bytes[4] memory sigs = _signAll(gameId, ranking);
        vm.expectRevert(MahjongTable.InvalidRanking.selector);
        mahjong.settle(gameId, ranking, sigs);
    }

    function test_RevertWhen_Settle_RankingHasOutsider() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = [players[0], players[1], players[2], outsider];
        bytes[4] memory sigs = _signAll(gameId, ranking);
        vm.expectRevert(MahjongTable.NotAPlayer.selector);
        mahjong.settle(gameId, ranking, sigs);
    }

    // ======================================================== settleByServer

    function test_SettleByServer_AfterDeadline() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = [players[3], players[2], players[1], players[0]];
        bytes memory serverSig = _sign(serverPk, mahjong.resultDigest(gameId, ranking));

        vm.warp(block.timestamp + 1 hours + 1);
        mahjong.settleByServer(gameId, ranking, serverSig);

        assertEq(mahjong.creditOf(address(token), players[3]), 9.7e18); // juara 1
        assertEq(uint256(mahjong.getGame(gameId).status), uint256(MahjongTable.Status.Settled));
    }

    function test_RevertWhen_SettleByServer_BeforeDeadline() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = [players[3], players[2], players[1], players[0]];
        bytes memory serverSig = _sign(serverPk, mahjong.resultDigest(gameId, ranking));
        vm.expectRevert(MahjongTable.DeadlineNotReached.selector);
        mahjong.settleByServer(gameId, ranking, serverSig);
    }

    function test_RevertWhen_SettleByServer_WrongSigner() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = [players[3], players[2], players[1], players[0]];
        bytes memory badSig = _sign(pks[0], mahjong.resultDigest(gameId, ranking));
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(MahjongTable.BadSignature.selector);
        mahjong.settleByServer(gameId, ranking, badSig);
    }

    function test_RevertWhen_SettleByServer_WrongStatus() public {
        uint256 gameId = _createGame();
        _joinAll(gameId); // Revealing
        address[4] memory ranking = _orderedRanking();
        bytes memory serverSig = _sign(serverPk, mahjong.resultDigest(gameId, ranking));
        vm.warp(block.timestamp + 10 hours);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.settleByServer(gameId, ranking, serverSig);
    }

    // ============================================ settle native + withdraw

    function test_Settle_Native_ThenWithdraw() public {
        uint256 gameId = _createNativeGame();
        _joinAllNative(gameId);
        _revealAll(gameId);

        address[4] memory ranking = _orderedRanking();
        mahjong.settle(gameId, ranking, _signAll(gameId, ranking));

        assertEq(mahjong.creditOf(NATIVE, players[0]), 9.7e18);
        assertEq(address(mahjong).balance, BUY_IN * 4); // pot tertahan

        uint256 before = players[0].balance;
        vm.prank(players[0]);
        mahjong.withdraw(NATIVE);
        assertEq(players[0].balance - before, 9.7e18);
        assertEq(mahjong.creditOf(NATIVE, players[0]), 0);

        // owner tarik rake native
        vm.prank(owner);
        mahjong.withdraw(NATIVE);
        assertEq(owner.balance, 0.6e18);
    }

    // ========================================================= cancelUnfilled

    function test_CancelUnfilled_CreditsRefund() public {
        uint256 gameId = _createGame();
        _join(gameId, 0);
        _join(gameId, 1);
        vm.warp(block.timestamp + 1 hours + 1);
        mahjong.cancelUnfilled(gameId);

        assertEq(mahjong.creditOf(address(token), players[0]), BUY_IN);
        assertEq(mahjong.creditOf(address(token), players[1]), BUY_IN);
        assertEq(uint256(mahjong.getGame(gameId).status), uint256(MahjongTable.Status.Cancelled));

        vm.prank(players[0]);
        mahjong.withdraw(address(token));
        assertEq(token.balanceOf(players[0]), START_BAL);
    }

    function test_RevertWhen_CancelUnfilled_BeforeDeadline() public {
        uint256 gameId = _createGame();
        _join(gameId, 0);
        vm.expectRevert(MahjongTable.DeadlineNotReached.selector);
        mahjong.cancelUnfilled(gameId);
    }

    function test_RevertWhen_CancelUnfilled_WhenFull() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.cancelUnfilled(gameId);
    }

    // ====================================================== cancelUnrevealed

    function test_CancelUnrevealed_ForfeitsNonRevealer() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        for (uint256 i; i < 3; ++i) {
            vm.prank(players[i]);
            mahjong.revealSeed(gameId, _secret(i));
        }
        vm.warp(block.timestamp + 1 hours + 1);
        mahjong.cancelUnrevealed(gameId);

        uint256 share = uint256(BUY_IN) / 3; // forfeitPool 1*BUY_IN dibagi 3
        for (uint256 i; i < 3; ++i) {
            assertEq(mahjong.creditOf(address(token), players[i]), BUY_IN + share);
        }
        assertEq(mahjong.creditOf(address(token), players[3]), 0); // forfeit
        assertEq(mahjong.creditOf(address(token), owner), BUY_IN - share * 3); // dust
    }

    function test_CancelUnrevealed_NobodyRevealed_RefundsAll() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.warp(block.timestamp + 1 hours + 1);
        mahjong.cancelUnrevealed(gameId);

        for (uint256 i; i < 4; ++i) {
            assertEq(mahjong.creditOf(address(token), players[i]), BUY_IN);
        }
        assertEq(mahjong.creditOf(address(token), owner), 0);
    }

    function test_RevertWhen_CancelUnrevealed_BeforeDeadline() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.expectRevert(MahjongTable.DeadlineNotReached.selector);
        mahjong.cancelUnrevealed(gameId);
    }

    function test_RevertWhen_CancelUnrevealed_WhenPlaying() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.cancelUnrevealed(gameId);
    }

    // =============================================================== withdraw

    function test_RevertWhen_Withdraw_NothingToWithdraw() public {
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.NothingToWithdraw.selector);
        mahjong.withdraw(address(token));
    }

    function test_RevertWhen_Withdraw_Twice() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = _orderedRanking();
        mahjong.settle(gameId, ranking, _signAll(gameId, ranking));
        vm.prank(players[0]);
        mahjong.withdraw(address(token));
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.NothingToWithdraw.selector);
        mahjong.withdraw(address(token));
    }

    /// @dev Bukti guard transient bekerja: saat withdraw native mengirim CELO ke kontrak
    ///      penyerang, receive()-nya mencoba re-enter joinGame (yang valid bila guard absen)
    ///      → guard menendang → seluruh withdraw revert.
    function test_ReentrancyGuard_BlocksReentrantJoin() public {
        ReentrantJoiner attacker = new ReentrantJoiner(mahjong);
        vm.deal(address(attacker), 10e18);

        // Game A: attacker join, tak penuh, cancelUnfilled -> kredit native untuk attacker.
        uint256 gameA = _createNativeGame();
        attacker.join{value: BUY_IN}(gameA, bytes32(0));
        vm.warp(block.timestamp + 1 hours + 1);
        mahjong.cancelUnfilled(gameA);
        assertEq(mahjong.creditOf(NATIVE, address(attacker)), BUY_IN);

        // Game B: terbuka, jadi target reentry yang VALID (bila guard absen, join-nya sukses).
        uint256 gameB = _createNativeGame();
        attacker.arm(gameB, BUY_IN);

        vm.expectRevert(MahjongTable.NativeTransferFailed.selector);
        attacker.doWithdraw();
    }

    // ================================================================= admin

    function test_SetRakeBps() public {
        vm.prank(owner);
        mahjong.setRakeBps(500);
        assertEq(mahjong.rakeBps(), 500);
    }

    function test_RevertWhen_SetRakeBps_TooHigh() public {
        vm.prank(owner);
        vm.expectRevert(MahjongTable.RakeTooHigh.selector);
        mahjong.setRakeBps(1001);
    }

    function test_RevertWhen_SetRakeBps_NotOwner() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        mahjong.setRakeBps(500);
    }

    // ======================================================== payout configs

    function test_Settle_ZeroRake_FullPotDistributed() public {
        address[] memory toks = new address[](1);
        toks[0] = address(token);
        MahjongTable m = _deployProxy(0, toks);
        uint16[4] memory equalSplit = [uint16(2500), 2500, 2500, 2500];
        uint256 gameId = m.createGame(address(token), BUY_IN, server, equalSplit, 1 hours, 1 hours, 1 hours);

        for (uint256 i; i < 4; ++i) {
            vm.prank(players[i]);
            token.approve(address(m), type(uint256).max);
            bytes32 c = m.commitmentOf(gameId, players[i], _secret(i));
            vm.prank(players[i]);
            m.joinGame(gameId, c);
        }
        for (uint256 i; i < 4; ++i) {
            vm.prank(players[i]);
            m.revealSeed(gameId, _secret(i));
        }

        address[4] memory ranking = _orderedRanking();
        bytes32 digest = m.resultDigest(gameId, ranking);
        bytes[4] memory sigs;
        for (uint256 i; i < 4; ++i) {
            sigs[i] = _sign(pks[i], digest);
        }
        m.settle(gameId, ranking, sigs);

        for (uint256 i; i < 4; ++i) {
            assertEq(m.creditOf(address(token), players[i]), BUY_IN); // setor BUY_IN, dapat BUY_IN
        }
        assertEq(m.creditOf(address(token), owner), 0);
    }

    function test_Settle_WinnerTakeAll() public {
        address[] memory toks = new address[](1);
        toks[0] = address(token);
        MahjongTable m = _deployProxy(0, toks);
        uint16[4] memory wta = [uint16(10000), 0, 0, 0];
        uint256 gameId = m.createGame(address(token), BUY_IN, server, wta, 1 hours, 1 hours, 1 hours);

        for (uint256 i; i < 4; ++i) {
            vm.prank(players[i]);
            token.approve(address(m), type(uint256).max);
            bytes32 c = m.commitmentOf(gameId, players[i], _secret(i));
            vm.prank(players[i]);
            m.joinGame(gameId, c);
        }
        for (uint256 i; i < 4; ++i) {
            vm.prank(players[i]);
            m.revealSeed(gameId, _secret(i));
        }

        address[4] memory ranking = [players[2], players[0], players[1], players[3]];
        bytes32 digest = m.resultDigest(gameId, ranking);
        bytes[4] memory sigs;
        for (uint256 i; i < 4; ++i) {
            sigs[i] = _sign(pks[i], digest);
        }
        m.settle(gameId, ranking, sigs);

        assertEq(m.creditOf(address(token), players[2]), BUY_IN * 4); // ambil seluruh pot
        assertEq(m.creditOf(address(token), players[0]), 0);
    }

    // ===================================================== fairness / fuzz

    function testFuzz_SeedDependsOnAllSecrets(bytes32 s0, bytes32 s1, bytes32 s2, bytes32 s3) public {
        uint256 gameId = _createGame();
        bytes32[4] memory secrets = [s0, s1, s2, s3];
        for (uint256 i; i < 4; ++i) {
            bytes32 c = keccak256(abi.encodePacked(gameId, players[i], secrets[i]));
            vm.prank(players[i]);
            mahjong.joinGame(gameId, c);
        }
        for (uint256 i; i < 4; ++i) {
            vm.prank(players[i]);
            mahjong.revealSeed(gameId, secrets[i]);
        }
        assertEq(mahjong.getSeed(gameId), keccak256(abi.encodePacked(s0, s1, s2, s3)));
    }

    function testFuzz_PayoutConservesPot(uint16 a, uint16 b, uint16 c) public {
        a = uint16(bound(a, 1, 9997));
        b = uint16(bound(b, 1, 9998 - a));
        c = uint16(bound(c, 1, 9999 - a - b));
        uint16 d = uint16(10000 - a - b - c);
        uint16[4] memory weights = [a, b, c, d];

        uint256 gameId = mahjong.createGame(address(token), BUY_IN, server, weights, 1 hours, 1 hours, 1 hours);
        _joinAll(gameId);
        _revealAll(gameId);
        address[4] memory ranking = _orderedRanking();
        mahjong.settle(gameId, ranking, _signAll(gameId, ranking));

        // invariant: total kredit == pot (tak ada dana tercipta/hilang)
        uint256 totalCredit = mahjong.creditOf(address(token), owner);
        for (uint256 i; i < 4; ++i) {
            totalCredit += mahjong.creditOf(address(token), players[i]);
        }
        assertEq(totalCredit, BUY_IN * 4);
    }
}

/// @notice Kontrak penyerang untuk menguji reentrancy guard transient.
contract ReentrantJoiner {
    MahjongTable public immutable mahjong;
    uint256 public reenterGame;
    uint256 public reenterAmt;
    bool public armed;

    constructor(MahjongTable m) {
        mahjong = m;
    }

    function arm(uint256 g, uint256 amt) external {
        armed = true;
        reenterGame = g;
        reenterAmt = amt;
    }

    function join(uint256 gameId, bytes32 c) external payable {
        mahjong.joinGame{value: msg.value}(gameId, c);
    }

    function doWithdraw() external {
        mahjong.withdraw(address(0));
    }

    receive() external payable {
        if (armed) {
            armed = false;
            // Reentry yang VALID bila guard absen — guard transient harus memblokirnya.
            mahjong.joinGame{value: reenterAmt}(reenterGame, bytes32(uint256(1)));
        }
    }
}
