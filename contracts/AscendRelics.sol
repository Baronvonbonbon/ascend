// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * AscendRelics — relics struck into NFTs at the in-game forge.
 *
 * A relic token is a TROPHY. It records that you found and forged a particular relic; it confers
 * nothing in game, is not consumed on minting, and cannot be spent for an advantage. That is a
 * deliberate design constraint, not an oversight — the moment a token grants power, the dungeon
 * becomes pay-to-win.
 *
 * Metadata is composed ON CHAIN and returned as a `data:` URI. It deliberately does NOT live on
 * the Bulletin chain: Bulletin storage expires (~14 days by default) unless actively renewed, and
 * an NFT whose art evaporates a fortnight after minting is not an NFT. Relics are a glyph, a name
 * and a handful of numbers, so rendering them in Solidity is cheap and permanent.
 *
 * A compact, self-contained ERC-721 (no external dependency, since the deploy path is
 * solc → resolc → PolkaVM and every import is another thing to pin).
 */
contract AscendRelics {
    // ── ERC-721 ────────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    /** Emitted when a relic is struck, so an indexer can follow the forge without a state scan. */
    event Forged(address indexed forger, uint256 indexed tokenId, bytes32 name, uint16 depth);

    string public constant name = "Ascend Relics";
    string public constant symbol = "RELIC";

    mapping(uint256 => address) private _owner;
    mapping(address => uint256) private _balance;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;

    uint256 public totalSupply;

    struct Relic {
        bytes32 itemName;  // e.g. "the Sceptre of Might"
        bytes32 glyph;     // the map glyph it was worn as — one or two UTF-8 chars
        int8    enchant;   // +n / -n
        uint8   buc;       // 0 cursed · 1 uncursed · 2 blessed
        uint16  depth;     // the depth it was forged at
        uint40  at;
        bytes32 runHash;   // ties the relic to a submitted run
        address forger;    // who struck it (immutable, unlike the owner)
    }

    mapping(uint256 => Relic) public relicOf;

    // ── forging ────────────────────────────────────────────────────────────────

    function forge(
        bytes32 itemName,
        bytes32 glyph,
        int8 enchant,
        uint8 buc,
        uint16 depth,
        bytes32 runHash
    ) external returns (uint256 tokenId) {
        require(buc <= 2, "buc");
        unchecked { tokenId = ++totalSupply; }
        relicOf[tokenId] = Relic(itemName, glyph, enchant, buc, depth, uint40(block.timestamp), runHash, msg.sender);
        _owner[tokenId] = msg.sender;
        unchecked { _balance[msg.sender]++; }
        emit Transfer(address(0), msg.sender, tokenId);
        emit Forged(msg.sender, tokenId, itemName, depth);
    }

    /** Every relic held by `who`. Bounded by totalSupply — fine for a light client, not for a whale. */
    function relicsOf(address who) external view returns (uint256[] memory out) {
        uint256 n = _balance[who];
        out = new uint256[](n);
        uint256 j;
        for (uint256 i = 1; i <= totalSupply && j < n; i++) if (_owner[i] == who) out[j++] = i;
    }

    // ── metadata, composed on chain ────────────────────────────────────────────

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owner[tokenId] != address(0), "nonexistent");
        Relic memory r = relicOf[tokenId];
        string memory title = string.concat(_str(r.itemName), " ", _sign(r.enchant));
        string memory json = string.concat(
            '{"name":"', title,
            '","description":"A relic recovered from the Dungeon of Yendor and struck at the forge.',
            ' It is a record of the descent that found it, and confers nothing upon its bearer.",',
            '"attributes":[',
                '{"trait_type":"Enchantment","value":', _int(r.enchant), '},',
                '{"trait_type":"Sanctity","value":"', _buc(r.buc), '"},',
                '{"trait_type":"Depth","value":', _uint(r.depth), '},',
                '{"trait_type":"Forged","display_type":"date","value":', _uint(r.at), '}',
            '],"image":"data:image/svg+xml;base64,', _b64(bytes(_svg(r, title))), '"}'
        );
        return string.concat("data:application/json;base64,", _b64(bytes(json)));
    }

    function _svg(Relic memory r, string memory title) private pure returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
            '<rect width="400" height="400" fill="#0b0b0d"/>',
            '<rect x="12" y="12" width="376" height="376" fill="none" stroke="#e0b94d" stroke-width="2"/>',
            '<text x="200" y="190" font-family="monospace" font-size="120" fill="#e0b94d" text-anchor="middle">',
                _str(r.glyph),
            '</text>',
            '<text x="200" y="270" font-family="monospace" font-size="20" fill="#e0b94d" text-anchor="middle">',
                title,
            '</text>',
            '<text x="200" y="305" font-family="monospace" font-size="14" fill="#8a8a90" text-anchor="middle">',
                _buc(r.buc), ' &#183; depth ', _uint(r.depth),
            '</text></svg>'
        );
    }

    function _buc(uint8 b) private pure returns (string memory) {
        return b == 0 ? "cursed" : b == 2 ? "blessed" : "uncursed";
    }

    function _sign(int8 e) private pure returns (string memory) {
        if (e == 0) return "";
        return e > 0 ? string.concat("+", _uint(uint8(e))) : string.concat("-", _uint(uint8(-e)));
    }

    function _int(int8 e) private pure returns (string memory) {
        return e < 0 ? string.concat("-", _uint(uint8(-e))) : _uint(uint8(e));
    }

    /** bytes32 → string, stopping at the first NUL so short names do not carry padding. */
    function _str(bytes32 b) private pure returns (string memory) {
        uint256 len;
        while (len < 32 && b[len] != 0) len++;
        bytes memory out = new bytes(len);
        for (uint256 i = 0; i < len; i++) out[i] = b[i];
        return string(out);
    }

    function _uint(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 d;
        for (uint256 t = v; t != 0; t /= 10) d++;
        bytes memory s = new bytes(d);
        for (uint256 i = d; i > 0; i--) { s[i - 1] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(s);
    }

    function _b64(bytes memory data) private pure returns (string memory) {
        if (data.length == 0) return "";
        bytes memory tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint256 outLen = 4 * ((data.length + 2) / 3);
        bytes memory out = new bytes(outLen);
        uint256 p = 0;
        for (uint256 i = 0; i < data.length; i += 3) {
            uint256 a = uint8(data[i]);
            uint256 b = i + 1 < data.length ? uint8(data[i + 1]) : 0;
            uint256 c = i + 2 < data.length ? uint8(data[i + 2]) : 0;
            uint256 n = (a << 16) | (b << 8) | c;
            out[p++] = tbl[(n >> 18) & 63];
            out[p++] = tbl[(n >> 12) & 63];
            out[p++] = i + 1 < data.length ? tbl[(n >> 6) & 63] : bytes1("=");
            out[p++] = i + 2 < data.length ? tbl[n & 63] : bytes1("=");
        }
        return string(out);
    }

    // ── ERC-721 plumbing ───────────────────────────────────────────────────────

    function balanceOf(address o) external view returns (uint256) { require(o != address(0), "zero"); return _balance[o]; }
    function ownerOf(uint256 id) public view returns (address o) { o = _owner[id]; require(o != address(0), "nonexistent"); }
    function getApproved(uint256 id) external view returns (address) { require(_owner[id] != address(0), "nonexistent"); return _approved[id]; }
    function isApprovedForAll(address o, address op) external view returns (bool) { return _operator[o][op]; }

    function approve(address to, uint256 id) external {
        address o = ownerOf(id);
        require(msg.sender == o || _operator[o][msg.sender], "not authorized");
        _approved[id] = to;
        emit Approval(o, to, id);
    }

    function setApprovalForAll(address op, bool ok) external {
        _operator[msg.sender][op] = ok;
        emit ApprovalForAll(msg.sender, op, ok);
    }

    function transferFrom(address from, address to, uint256 id) public {
        require(ownerOf(id) == from, "wrong owner");
        require(to != address(0), "zero");
        require(msg.sender == from || _approved[id] == msg.sender || _operator[from][msg.sender], "not authorized");
        delete _approved[id];
        unchecked { _balance[from]--; _balance[to]++; }
        _owner[id] = to;
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external { safeTransferFrom(from, to, id, ""); }

    function safeTransferFrom(address from, address to, uint256 id, bytes memory data) public {
        transferFrom(from, to, id);
        if (to.code.length > 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, id, data) == IERC721Receiver.onERC721Received.selector,
                "unsafe recipient"
            );
        }
    }

    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x01ffc9a7  // ERC165
            || iid == 0x80ac58cd  // ERC721
            || iid == 0x5b5e139f; // ERC721Metadata
    }
}

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}
