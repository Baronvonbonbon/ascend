// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

/// @title  AscendGear
/// @notice On-chain, **tradeable** gear for Ascend — a standard ERC-721 so any
///         marketplace (Datum Tavern or other) can list/trade it. Each token
///         carries gear attributes (item id + enchant level) read on-chain, and
///         surfaces back inside Ascend as persistent relics. Minting is done by
///         a `minter` (the relay), so players earn relics gaslessly.
contract AscendGear {
    string public name = "Ascend Gear";
    string public symbol = "ASCG";
    string public baseURI; // owner-settable metadata base (points at a renderer)

    address public owner;
    address public minter;
    uint256 private _next = 1;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;

    // per-owner enumeration (for in-game reads)
    mapping(address => uint256[]) private _owned;
    mapping(uint256 => uint256) private _ownedIndex;

    // gear attributes
    mapping(uint256 => string) public itemId;
    mapping(uint256 => uint8) public enchant;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Minted(address indexed to, uint256 indexed tokenId, string itemId, uint8 enchant);

    constructor() { owner = msg.sender; minter = msg.sender; }

    // ── admin ──
    function setMinter(address m) external { require(msg.sender == owner, "not owner"); minter = m; }
    function setBaseURI(string calldata u) external { require(msg.sender == owner, "not owner"); baseURI = u; }

    // ── mint (relay) ──
    function mint(address to, string calldata id, uint8 ench) external returns (uint256 tokenId) {
        require(msg.sender == minter, "not minter");
        require(to != address(0), "zero to");
        tokenId = _next++;
        itemId[tokenId] = id;
        enchant[tokenId] = ench;
        _mint(to, tokenId);
        emit Minted(to, tokenId, id, ench);
    }

    // ── ERC-721 core ──
    function balanceOf(address a) external view returns (uint256) { require(a != address(0), "zero"); return _balances[a]; }
    function ownerOf(uint256 id) public view returns (address o) { o = _owners[id]; require(o != address(0), "nonexistent"); }

    function approve(address to, uint256 id) external {
        address o = ownerOf(id);
        require(to != o, "self");
        require(msg.sender == o || _operator[o][msg.sender], "not authorized");
        _approved[id] = to;
        emit Approval(o, to, id);
    }
    function getApproved(uint256 id) external view returns (address) { require(_owners[id] != address(0), "nonexistent"); return _approved[id]; }
    function setApprovalForAll(address op, bool ok) external { _operator[msg.sender][op] = ok; emit ApprovalForAll(msg.sender, op, ok); }
    function isApprovedForAll(address o, address op) public view returns (bool) { return _operator[o][op]; }

    function transferFrom(address from, address to, uint256 id) public {
        require(_isApprovedOrOwner(msg.sender, id), "not authorized");
        _transfer(from, to, id);
    }
    function safeTransferFrom(address from, address to, uint256 id) external { safeTransferFrom(from, to, id, ""); }
    function safeTransferFrom(address from, address to, uint256 id, bytes memory data) public {
        transferFrom(from, to, id);
        require(_checkReceiver(from, to, id, data), "bad receiver");
    }

    // ── in-game reads ──
    function tokensOf(address a) external view returns (uint256[] memory) { return _owned[a]; }
    function gearOf(address a) external view returns (uint256[] memory ids, string[] memory items, uint8[] memory enchants) {
        uint256[] storage list = _owned[a];
        uint256 n = list.length;
        ids = new uint256[](n); items = new string[](n); enchants = new uint8[](n);
        for (uint256 i; i < n; i++) { ids[i] = list[i]; items[i] = itemId[list[i]]; enchants[i] = enchant[list[i]]; }
    }
    function tokenURI(uint256 id) external view returns (string memory) {
        require(_owners[id] != address(0), "nonexistent");
        return bytes(baseURI).length == 0 ? "" : string(abi.encodePacked(baseURI, _toString(id)));
    }
    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x80ac58cd || iid == 0x5b5e139f || iid == 0x01ffc9a7; // ERC721, Metadata, ERC165
    }

    // ── internal ──
    function _isApprovedOrOwner(address s, uint256 id) internal view returns (bool) {
        address o = ownerOf(id);
        return s == o || _approved[id] == s || _operator[o][s];
    }
    function _mint(address to, uint256 id) internal {
        _owners[id] = to;
        _balances[to] += 1;
        _ownedIndex[id] = _owned[to].length;
        _owned[to].push(id);
        emit Transfer(address(0), to, id);
    }
    function _transfer(address from, address to, uint256 id) internal {
        require(ownerOf(id) == from, "wrong from");
        require(to != address(0), "zero to");
        delete _approved[id];
        _removeOwned(from, id);
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[id] = to;
        _ownedIndex[id] = _owned[to].length;
        _owned[to].push(id);
        emit Transfer(from, to, id);
    }
    function _removeOwned(address from, uint256 id) internal {
        uint256 last = _owned[from].length - 1;
        uint256 idx = _ownedIndex[id];
        if (idx != last) { uint256 moved = _owned[from][last]; _owned[from][idx] = moved; _ownedIndex[moved] = idx; }
        _owned[from].pop();
        delete _ownedIndex[id];
    }
    function _checkReceiver(address from, address to, uint256 id, bytes memory data) internal returns (bool) {
        if (to.code.length == 0) return true;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, id, data) returns (bytes4 ret) {
            return ret == IERC721Receiver.onERC721Received.selector;
        } catch { return false; }
    }
    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 t = v; uint256 d;
        while (t != 0) { d++; t /= 10; }
        bytes memory b = new bytes(d);
        while (v != 0) { d--; b[d] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }
}
