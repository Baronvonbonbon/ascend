// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

/// @title  AscendDeed
/// @notice A soulbound (non-transferable) ERC-721 — the proof that a wallet truly
///         ASCENDED in Ascend: recovered the JAM from Moloch and offered it on the
///         aligned altar of the Genesis Plane. One deed per address, claimed
///         permissionlessly by the winner from their own wallet. It cannot be sold
///         or transferred — only earned. (Trust model matches AscendLedger: the
///         client self-reports the win, consistent with the rest of this testnet game.)
contract AscendDeed {
    string public constant name = "Ascend Deed of Ascension";
    string public constant symbol = "ASCEND";

    struct Deed { uint16 depth; uint64 time; uint32 epoch; }

    uint256 public totalSupply;                    // also the last-minted tokenId (ids start at 1)
    mapping(uint256 => address) public ownerOf;    // tokenId => owner
    mapping(address => uint256) public balanceOf;  // 0 or 1 — soulbound, one each
    mapping(address => uint256) public deedId;     // owner => their tokenId (0 = none)
    mapping(uint256 => Deed) public deedInfo;      // tokenId => details

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Ascended(address indexed hero, uint256 indexed tokenId, uint16 depth, uint32 epoch);

    /// @notice Claim your Deed of Ascension. One per wallet; the token is soulbound.
    /// @param depth The depth conquered (Moloch's Sanctum).
    /// @param epoch The hero's experience level (epoch) at ascension.
    function claim(uint16 depth, uint32 epoch) external returns (uint256 tokenId) {
        require(balanceOf[msg.sender] == 0, "already ascended");
        tokenId = ++totalSupply;
        ownerOf[tokenId] = msg.sender;
        balanceOf[msg.sender] = 1;
        deedId[msg.sender] = tokenId;
        deedInfo[tokenId] = Deed(depth, uint64(block.timestamp), epoch);
        emit Transfer(address(0), msg.sender, tokenId);
        emit Ascended(msg.sender, tokenId, depth, epoch);
    }

    function hasDeed(address a) external view returns (bool) { return balanceOf[a] != 0; }

    function deedOf(address a) external view returns (uint256 tokenId, uint16 depth, uint64 time, uint32 epoch) {
        tokenId = deedId[a];
        Deed memory d = deedInfo[tokenId];
        return (tokenId, d.depth, d.time, d.epoch);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(ownerOf[tokenId] != address(0), "no token");
        Deed memory d = deedInfo[tokenId];
        return string(abi.encodePacked(
            'data:application/json,{"name":"Deed of Ascension #', _u(tokenId),
            '","description":"Proof that this wallet ascended in Ascend - recovered the JAM and offered it on the Genesis Plane. Soulbound.",',
            '"attributes":[{"trait_type":"Depth","value":', _u(d.depth),
            '},{"trait_type":"Epoch","value":', _u(d.epoch), '}]}'
        ));
    }

    // ── ERC-165 ──
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7  // ERC-165
            || id == 0x80ac58cd  // ERC-721
            || id == 0x5b5e139f; // ERC-721 Metadata
    }

    // ── Soulbound: every transfer / approval path reverts ──
    function approve(address, uint256) external pure { revert("soulbound"); }
    function setApprovalForAll(address, bool) external pure { revert("soulbound"); }
    function getApproved(uint256) external pure returns (address) { return address(0); }
    function isApprovedForAll(address, address) external pure returns (bool) { return false; }
    function transferFrom(address, address, uint256) external pure { revert("soulbound"); }
    function safeTransferFrom(address, address, uint256) external pure { revert("soulbound"); }
    function safeTransferFrom(address, address, uint256, bytes calldata) external pure { revert("soulbound"); }

    function _u(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 n = v;
        uint256 len;
        while (n != 0) { len++; n /= 10; }
        bytes memory b = new bytes(len);
        while (v != 0) { b[--len] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(b);
    }
}
