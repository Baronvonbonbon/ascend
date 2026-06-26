// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
}

/// @title  AscendGear
/// @notice On-chain, **tradeable** gear for Ascend — a standard ERC-721 so any
///         marketplace (Datum Tavern or other) can list/trade it. Minting is
///         **permissionless and direct**: a player forges a relic from their own
///         wallet (no relay, no trusted minter). On-chain anti-cheat is enforced
///         by *bounds, price, and a cooldown* — and a forged relic's **rarity is
///         rolled on-chain** (Common→Legendary), which adds to its enchant. An
///         optional **luck token** (e.g. WUD) tilts the odds toward rarer rolls.
///
/// @dev    The rarity roll uses pseudo-randomness (prevrandao/blockhash/nonce).
///         It is NOT manipulation-proof — a sophisticated caller could revert on
///         a bad roll — which is acceptable for a testnet game. Upgrade path:
///         commit-reveal or a VRF. The game being client-side, no contract can
///         verify a relic was *earned*; these levers bound and price minting.
contract AscendGear {
    string public name = "Ascend Gear";
    string public symbol = "ASCG";
    string public baseURI;

    address public owner;
    uint256 private _next = 1;

    // ── forge economics / anti-cheat ──
    uint8   public constant MAX_BASE_ENCHANT = 3;     // the most you may bring to the forge
    uint8   public constant FINAL_CAP        = 6;     // base + rarity bonus, capped
    uint256 public mintBase = 8 ether;                // price = mintBase + baseEnchant * mintStep (PAS, 18dp)
    uint256 public mintStep = 6 ether;
    uint256 public cooldown = 15;                     // seconds between forges per address
    address public luckToken;                         // e.g. WUD; address(0) = disabled
    uint256 public luckThreshold;                     // holding >= this flips you to the lucky table

    mapping(bytes32 => bool) public allowedId;        // keccak(itemId) => mintable
    mapping(address => uint256) public lastForge;
    mapping(address => uint256) private forgeNonce;

    // ── ERC-721 state ──
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;
    mapping(address => uint256[]) private _owned;
    mapping(uint256 => uint256) private _ownedIndex;

    // ── gear attributes ──
    mapping(uint256 => string) public itemId;
    mapping(uint256 => uint8) public enchant;
    mapping(uint256 => uint8) public rarity; // 0 Common, 1 Rare, 2 Epic, 3 Legendary

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Forged(address indexed to, uint256 indexed tokenId, string itemId, uint8 enchant, uint8 rarity);

    constructor(string[] memory ids) {
        owner = msg.sender;
        for (uint256 i; i < ids.length; i++) allowedId[keccak256(bytes(ids[i]))] = true;
    }

    // ── admin ──
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    function setBaseURI(string calldata u) external onlyOwner { baseURI = u; }
    function setPrice(uint256 base_, uint256 step_) external onlyOwner { mintBase = base_; mintStep = step_; }
    function setCooldown(uint256 s) external onlyOwner { cooldown = s; }
    function setLuck(address token, uint256 threshold) external onlyOwner { luckToken = token; luckThreshold = threshold; }
    function setAllowed(string calldata id, bool ok) external onlyOwner { allowedId[keccak256(bytes(id))] = ok; }
    function ownerWithdraw(uint256 amount, address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "xfer");
    }

    // ── forge (permissionless, direct, payable) ──
    function forgePrice(uint8 baseEnchant) public view returns (uint256) {
        return mintBase + uint256(baseEnchant) * mintStep;
    }

    /// @notice Forge one of your in-run items into a tradeable NFT relic. Rarity is
    ///         rolled on-chain and adds to the enchant. Mints to the caller only.
    function forge(string calldata id, uint8 baseEnchant) external payable returns (uint256 tokenId) {
        require(allowedId[keccak256(bytes(id))], "id not forgeable");
        require(baseEnchant <= MAX_BASE_ENCHANT, "enchant too high");
        require(block.timestamp >= lastForge[msg.sender] + cooldown, "cooldown");
        require(msg.value >= forgePrice(baseEnchant), "underpaid");
        lastForge[msg.sender] = block.timestamp;

        uint8 tier = _rollRarity(msg.sender);
        uint8 ench = baseEnchant + tier;
        if (ench > FINAL_CAP) ench = FINAL_CAP;

        tokenId = _next++;
        itemId[tokenId] = id;
        enchant[tokenId] = ench;
        rarity[tokenId] = tier;
        _mint(msg.sender, tokenId);
        emit Forged(msg.sender, tokenId, id, ench, tier);
    }

    function _rollRarity(address who) internal returns (uint8) {
        uint256 r = uint256(keccak256(abi.encodePacked(
            block.prevrandao, block.timestamp, blockhash(block.number - 1), who, forgeNonce[who]++
        ))) % 1000;
        if (_isLucky(who)) {
            // lucky table: 40 / 32 / 20 / 8 %
            if (r < 400) return 0;
            if (r < 720) return 1;
            if (r < 920) return 2;
            return 3;
        }
        // base table: 60 / 27 / 11 / 2 %
        if (r < 600) return 0;
        if (r < 870) return 1;
        if (r < 980) return 2;
        return 3;
    }

    function _isLucky(address who) internal view returns (bool) {
        if (luckToken == address(0) || luckThreshold == 0) return false;
        try IERC20(luckToken).balanceOf(who) returns (uint256 bal) { return bal >= luckThreshold; } catch { return false; }
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
    function gearOf(address a) external view returns (uint256[] memory ids, string[] memory items, uint8[] memory enchants, uint8[] memory rarities) {
        uint256[] storage list = _owned[a];
        uint256 n = list.length;
        ids = new uint256[](n); items = new string[](n); enchants = new uint8[](n); rarities = new uint8[](n);
        for (uint256 i; i < n; i++) { ids[i] = list[i]; items[i] = itemId[list[i]]; enchants[i] = enchant[list[i]]; rarities[i] = rarity[list[i]]; }
    }
    function tokenURI(uint256 id) external view returns (string memory) {
        require(_owners[id] != address(0), "nonexistent");
        return bytes(baseURI).length == 0 ? "" : string(abi.encodePacked(baseURI, _toString(id)));
    }
    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x80ac58cd || iid == 0x5b5e139f || iid == 0x01ffc9a7;
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
