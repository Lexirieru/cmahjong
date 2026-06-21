// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MahjongTable} from "../src/MahjongTable.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MahjongTableTest is Test {
    MahjongTable internal mahjong;
    MockERC20 internal token;

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
        mahjong = new MahjongTable(token, owner, RAKE_BPS);
        (server, serverPk) = makeAddrAndKey("server");

        for (uint256 i; i < 4; ++i) {
            (address a, uint256 k) = makeAddrAndKey(string.concat("player", vm.toString(i)));
            players[i] = a;
            pks[i] = k;
            token.mint(a, START_BAL);
            vm.prank(a);
            token.approve(address(mahjong), type(uint256).max);
        }
    }

    // ----------------------------------------------------------------- helpers

    function _createGame() internal returns (uint256 gameId) {
        gameId = mahjong.createGame(BUY_IN, server, payoutBps, 1 hours, 1 hours, 1 hours);
    }

    function _secret(uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("secret", i));
    }

    function _join(uint256 gameId, uint256 i) internal {
        bytes32 commitment = mahjong.commitmentOf(gameId, players[i], _secret(i));
        vm.prank(players[i]);
        mahjong.joinGame(gameId, commitment);
    }

    function _joinAll(uint256 gameId) internal {
        for (uint256 i; i < 4; ++i) _join(gameId, i);
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
        for (uint256 i; i < 4; ++i) sigs[i] = _sign(pks[i], digest);
    }

    function _toPlaying(uint256 gameId) internal {
        _joinAll(gameId);
        _revealAll(gameId);
    }

    // =========================================================== constructor

    function test_Constructor_SetsState() public view {
        assertEq(address(mahjong.token()), address(token));
        assertEq(mahjong.owner(), owner);
        assertEq(mahjong.rakeBps(), RAKE_BPS);
        assertEq(mahjong.gameCount(), 0);
    }

    function test_RevertWhen_Constructor_ZeroToken() public {
        vm.expectRevert(MahjongTable.InvalidServer.selector);
        new MahjongTable(IERC20(address(0)), owner, RAKE_BPS);
    }

    function test_RevertWhen_Constructor_RakeTooHigh() public {
        vm.expectRevert(MahjongTable.RakeTooHigh.selector);
        new MahjongTable(token, owner, 1001);
    }

    // ============================================================ createGame

    function test_CreateGame_IncrementsIdAndStores() public {
        uint256 id1 = _createGame();
        uint256 id2 = _createGame();
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(mahjong.gameCount(), 2);

        MahjongTable.Game memory g = mahjong.getGame(id1);
        assertEq(g.buyIn, BUY_IN);
        assertEq(g.server, server);
        assertEq(uint256(g.status), uint256(MahjongTable.Status.Open));
        assertEq(g.commitDeadline, block.timestamp + 1 hours);
    }

    function test_RevertWhen_CreateGame_ZeroBuyIn() public {
        vm.expectRevert(MahjongTable.InvalidBuyIn.selector);
        mahjong.createGame(0, server, payoutBps, 1 hours, 1 hours, 1 hours);
    }

    function test_RevertWhen_CreateGame_ZeroServer() public {
        vm.expectRevert(MahjongTable.InvalidServer.selector);
        mahjong.createGame(BUY_IN, address(0), payoutBps, 1 hours, 1 hours, 1 hours);
    }

    function test_RevertWhen_CreateGame_BadPayoutSum() public {
        uint16[4] memory bad = [uint16(5000), 3000, 1500, 499]; // sum 9999
        vm.expectRevert(MahjongTable.InvalidPayoutWeights.selector);
        mahjong.createGame(BUY_IN, server, bad, 1 hours, 1 hours, 1 hours);
    }

    function test_RevertWhen_CreateGame_ZeroWindow() public {
        vm.expectRevert(MahjongTable.InvalidWindow.selector);
        mahjong.createGame(BUY_IN, server, payoutBps, 0, 1 hours, 1 hours);
        vm.expectRevert(MahjongTable.InvalidWindow.selector);
        mahjong.createGame(BUY_IN, server, payoutBps, 1 hours, 0, 1 hours);
        vm.expectRevert(MahjongTable.InvalidWindow.selector);
        mahjong.createGame(BUY_IN, server, payoutBps, 1 hours, 1 hours, 0);
    }

    // ============================================================== joinGame

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

    function test_RevertWhen_JoinGame_InsufficientBalance() public {
        uint256 gameId = _createGame();
        address poor = makeAddr("poor");
        vm.prank(poor);
        token.approve(address(mahjong), type(uint256).max); // approve tapi saldo 0
        bytes32 c = mahjong.commitmentOf(gameId, poor, _secret(0));
        vm.prank(poor);
        vm.expectRevert(); // ERC20InsufficientBalance
        mahjong.joinGame(gameId, c);
    }

    // ============================================================ revealSeed

    function test_RevealSeed_BuildsDeterministicSeed() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        _revealAll(gameId);

        bytes32 expected =
            keccak256(abi.encodePacked(_secret(0), _secret(1), _secret(2), _secret(3)));
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
        // commitment mengikat ke (gameId, player); secret pemain lain tak cocok
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.prank(players[0]);
        vm.expectRevert(MahjongTable.BadReveal.selector);
        mahjong.revealSeed(gameId, _secret(1));
    }

    // ================================================================ settle

    function test_Settle_PaysUmaOkaAndConservesPot() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);

        address[4] memory ranking = [players[0], players[1], players[2], players[3]];
        bytes[4] memory sigs = _signAll(gameId, ranking);

        uint256[4] memory before;
        for (uint256 i; i < 4; ++i) before[i] = token.balanceOf(players[i]);

        mahjong.settle(gameId, ranking, sigs);

        // pot=20e18, rake=0.6e18, distributable=19.4e18
        assertEq(token.balanceOf(players[0]) - before[0], 9.7e18);
        assertEq(token.balanceOf(players[1]) - before[1], 5.82e18);
        assertEq(token.balanceOf(players[2]) - before[2], 2.91e18);
        assertEq(token.balanceOf(players[3]) - before[3], 0.97e18);
        assertEq(mahjong.accruedRake(), 0.6e18);
        assertEq(uint256(mahjong.getGame(gameId).status), uint256(MahjongTable.Status.Settled));
        // konservasi: kontrak hanya menyisakan rake
        assertEq(token.balanceOf(address(mahjong)), mahjong.accruedRake());
    }

    function test_Settle_SignatureOrderIndependent() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);

        address[4] memory ranking = [players[1], players[3], players[0], players[2]];
        bytes32 digest = mahjong.resultDigest(gameId, ranking);
        // urutan tanda tangan diacak (bukan urutan ranking)
        bytes[4] memory sigs;
        sigs[0] = _sign(pks[2], digest);
        sigs[1] = _sign(pks[0], digest);
        sigs[2] = _sign(pks[3], digest);
        sigs[3] = _sign(pks[1], digest);

        mahjong.settle(gameId, ranking, sigs);
        assertEq(token.balanceOf(players[1]), START_BAL - BUY_IN + 9.7e18); // juara 1
    }

    function test_RevertWhen_Settle_WrongStatus() public {
        uint256 gameId = _createGame();
        _joinAll(gameId); // masih Revealing, belum Playing
        address[4] memory ranking = [players[0], players[1], players[2], players[3]];
        bytes[4] memory sigs = _signAll(gameId, ranking);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.settle(gameId, ranking, sigs);
    }

    function test_RevertWhen_Settle_Twice() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = [players[0], players[1], players[2], players[3]];
        bytes[4] memory sigs = _signAll(gameId, ranking);
        mahjong.settle(gameId, ranking, sigs);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.settle(gameId, ranking, sigs);
    }

    function test_RevertWhen_Settle_DuplicateSigner() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = [players[0], players[1], players[2], players[3]];
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
        address[4] memory ranking = [players[0], players[1], players[2], players[3]];
        (, uint256 outsiderPk) = makeAddrAndKey("randoSigner");
        bytes32 digest = mahjong.resultDigest(gameId, ranking);
        bytes[4] memory sigs;
        sigs[0] = _sign(pks[0], digest);
        sigs[1] = _sign(pks[1], digest);
        sigs[2] = _sign(pks[2], digest);
        sigs[3] = _sign(outsiderPk, digest); // bukan pemain
        vm.expectRevert(MahjongTable.NotAPlayer.selector);
        mahjong.settle(gameId, ranking, sigs);
    }

    function test_RevertWhen_Settle_SignaturesOverDifferentRanking() public {
        // sig menandatangani rankingA, tapi settle dipanggil dengan rankingB
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory rankingA = [players[0], players[1], players[2], players[3]];
        address[4] memory rankingB = [players[3], players[2], players[1], players[0]];
        bytes32 digestA = mahjong.resultDigest(gameId, rankingA);
        bytes[4] memory sigs;
        for (uint256 i; i < 4; ++i) sigs[i] = _sign(pks[i], digestA);
        // recover dengan digest B menghasilkan signer ngawur -> bukan pemain
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

        assertEq(token.balanceOf(players[3]) - (START_BAL - BUY_IN), 9.7e18); // juara 1
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
        // ditandatangani pemain, bukan server
        bytes memory badSig = _sign(pks[0], mahjong.resultDigest(gameId, ranking));
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(MahjongTable.BadSignature.selector);
        mahjong.settleByServer(gameId, ranking, badSig);
    }

    function test_RevertWhen_SettleByServer_WrongStatus() public {
        uint256 gameId = _createGame();
        _joinAll(gameId); // Revealing
        address[4] memory ranking = [players[0], players[1], players[2], players[3]];
        bytes memory serverSig = _sign(serverPk, mahjong.resultDigest(gameId, ranking));
        vm.warp(block.timestamp + 10 hours);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.settleByServer(gameId, ranking, serverSig);
    }

    // ========================================================= cancelUnfilled

    function test_CancelUnfilled_RefundsJoiners() public {
        uint256 gameId = _createGame();
        _join(gameId, 0);
        _join(gameId, 1);
        vm.warp(block.timestamp + 1 hours + 1);
        mahjong.cancelUnfilled(gameId);

        assertEq(token.balanceOf(players[0]), START_BAL);
        assertEq(token.balanceOf(players[1]), START_BAL);
        assertEq(token.balanceOf(address(mahjong)), 0);
        assertEq(uint256(mahjong.getGame(gameId).status), uint256(MahjongTable.Status.Cancelled));
    }

    function test_RevertWhen_CancelUnfilled_BeforeDeadline() public {
        uint256 gameId = _createGame();
        _join(gameId, 0);
        vm.expectRevert(MahjongTable.DeadlineNotReached.selector);
        mahjong.cancelUnfilled(gameId);
    }

    function test_RevertWhen_CancelUnfilled_WhenFull() public {
        uint256 gameId = _createGame();
        _joinAll(gameId); // Revealing, bukan Open
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
            assertEq(token.balanceOf(players[i]), START_BAL - BUY_IN + BUY_IN + share);
        }
        assertEq(token.balanceOf(players[3]), START_BAL - BUY_IN); // forfeit
        assertEq(mahjong.accruedRake(), BUY_IN - share * 3); // dust
        assertEq(token.balanceOf(address(mahjong)), mahjong.accruedRake());
    }

    function test_CancelUnrevealed_NobodyRevealed_RefundsAll() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.warp(block.timestamp + 1 hours + 1);
        mahjong.cancelUnrevealed(gameId);

        for (uint256 i; i < 4; ++i) {
            assertEq(token.balanceOf(players[i]), START_BAL);
        }
        assertEq(mahjong.accruedRake(), 0);
        assertEq(token.balanceOf(address(mahjong)), 0);
    }

    function test_RevertWhen_CancelUnrevealed_BeforeDeadline() public {
        uint256 gameId = _createGame();
        _joinAll(gameId);
        vm.expectRevert(MahjongTable.DeadlineNotReached.selector);
        mahjong.cancelUnrevealed(gameId);
    }

    function test_RevertWhen_CancelUnrevealed_WhenPlaying() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId); // sudah Playing
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(MahjongTable.WrongStatus.selector);
        mahjong.cancelUnrevealed(gameId);
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

    function test_WithdrawRake() public {
        uint256 gameId = _createGame();
        _toPlaying(gameId);
        address[4] memory ranking = [players[0], players[1], players[2], players[3]];
        mahjong.settle(gameId, ranking, _signAll(gameId, ranking));

        uint256 rake = mahjong.accruedRake();
        assertGt(rake, 0);
        vm.prank(owner);
        mahjong.withdrawRake(owner);
        assertEq(token.balanceOf(owner), rake);
        assertEq(mahjong.accruedRake(), 0);
    }

    function test_RevertWhen_WithdrawRake_NotOwner() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        mahjong.withdrawRake(outsider);
    }

    // ======================================================== payout configs

    function test_Settle_ZeroRake_FullPotDistributed() public {
        MahjongTable m = new MahjongTable(token, owner, 0);
        uint16[4] memory equalSplit = [uint16(2500), 2500, 2500, 2500];
        vm.prank(owner);
        uint256 gameId = m.createGame(BUY_IN, server, equalSplit, 1 hours, 1 hours, 1 hours);

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

        address[4] memory ranking = [players[0], players[1], players[2], players[3]];
        bytes32 digest = m.resultDigest(gameId, ranking);
        bytes[4] memory sigs;
        for (uint256 i; i < 4; ++i) sigs[i] = _sign(pks[i], digest);
        m.settle(gameId, ranking, sigs);

        for (uint256 i; i < 4; ++i) {
            assertEq(token.balanceOf(players[i]), START_BAL); // setor BUY_IN, dapat BUY_IN
        }
        assertEq(m.accruedRake(), 0);
        assertEq(token.balanceOf(address(m)), 0);
    }

    function test_Settle_WinnerTakeAll() public {
        MahjongTable m = new MahjongTable(token, owner, 0);
        uint16[4] memory wta = [uint16(10000), 0, 0, 0];
        vm.prank(owner);
        uint256 gameId = m.createGame(BUY_IN, server, wta, 1 hours, 1 hours, 1 hours);

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
        for (uint256 i; i < 4; ++i) sigs[i] = _sign(pks[i], digest);
        m.settle(gameId, ranking, sigs);

        assertEq(token.balanceOf(players[2]), START_BAL + BUY_IN * 3); // ambil seluruh pot lawan
        assertEq(token.balanceOf(players[0]), START_BAL - BUY_IN);
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

        MahjongTable m = new MahjongTable(token, owner, RAKE_BPS);
        vm.prank(owner);
        uint256 gameId = m.createGame(BUY_IN, server, weights, 1 hours, 1 hours, 1 hours);
        for (uint256 i; i < 4; ++i) {
            vm.prank(players[i]);
            token.approve(address(m), type(uint256).max);
            bytes32 cm = m.commitmentOf(gameId, players[i], _secret(i));
            vm.prank(players[i]);
            m.joinGame(gameId, cm);
        }
        for (uint256 i; i < 4; ++i) {
            vm.prank(players[i]);
            m.revealSeed(gameId, _secret(i));
        }
        address[4] memory ranking = [players[0], players[1], players[2], players[3]];
        bytes32 digest = m.resultDigest(gameId, ranking);
        bytes[4] memory sigs;
        for (uint256 i; i < 4; ++i) sigs[i] = _sign(pks[i], digest);
        m.settle(gameId, ranking, sigs);

        // invariant: tak ada dana tersangkut/tercipta — semua pot tersalurkan, sisa = rake
        assertEq(token.balanceOf(address(m)), m.accruedRake());
    }
}
