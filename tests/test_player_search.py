#!/usr/bin/env python3
"""Tests for the player-search ranking. Run: python3 tests/test_player_search.py

The ranking is pure, so it is tested directly against fixture candidates —
no Music.app and no network. Only the two I/O functions are left uncovered.
"""
import importlib.machinery
import importlib.util
import sys

sys.dont_write_bytecode = True  # keep bin/ free of __pycache__
import pathlib
import sys

spec = importlib.util.spec_from_loader(
    "player_search",
    importlib.machinery.SourceFileLoader(
        "player_search", str(pathlib.Path(__file__).parent.parent / "bin" / "player-search")))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

FAILED = []


def check(name, got, want):
    if got != want:
        FAILED.append(f"{name}: got {got!r}, want {want!r}")


def song(title, artist, source="catalog", album=""):
    return {"title": title, "artist": artist, "album": album,
            "source": source, "url": ""}


def rank(query, cands):
    """Score and sort fixtures the way find() does, without any I/O."""
    t, a = m.parse_query(query)
    for c in cands:
        c["_score"] = m.score(c, t, a, query)
    live = [c for c in cands if c["_score"] > 0]
    live.sort(key=lambda c: (-c["_score"], c["source"] != "library",
                             c.get("_api_rank", 999)))
    return live


# --- query parsing ---
check("parse plain", m.parse_query("bohemian rhapsody"), ("bohemian rhapsody", ""))
check("parse dash", m.parse_query("Yesterday - The Beatles"), ("Yesterday", "The Beatles"))
check("parse by", m.parse_query("Yesterday by The Beatles"), ("Yesterday", "The Beatles"))
check("parse emdash", m.parse_query("Monster — Red Velvet"), ("Monster", "Red Velvet"))
# A hyphenated title must not be torn apart at a dash with no spaces.
check("parse hyphen-word", m.parse_query("Jack-in-the-box"), ("Jack-in-the-box", ""))

# --- exact title wins over a longer title containing it ---
r = rank("bohemian rhapsody", [
    song("Bohemian Rhapsody (Live Aid)", "Queen"),
    song("Bohemian Rhapsody", "Queen"),
])
check("exact over variant", r[0]["title"], "Bohemian Rhapsody")

# --- an alternate take loses unless asked for ---
r = rank("yesterday", [song("Yesterday (Live)", "The Beatles"),
                       song("Yesterday", "The Beatles")])
check("studio over live", r[0]["title"], "Yesterday")
r = rank("yesterday live", [song("Yesterday", "The Beatles"),
                            song("Yesterday (Live)", "The Beatles")])
check("live when asked", r[0]["title"], "Yesterday (Live)")

# --- artist disambiguates a title many people covered ---
r = rank("bohemian rhapsody - Panic! At the Disco", [
    song("Bohemian Rhapsody", "Queen"),
    song("Bohemian Rhapsody", "Panic! At the Disco"),
])
check("artist picks cover", r[0]["artist"], "Panic! At the Disco")

# --- library beats an equal catalog hit, but not a better one ---
r = rank("monster", [song("Monster", "Red Velvet"),
                     song("Monster", "Red Velvet", source="library")])
check("library tiebreak", r[0]["source"], "library")
r = rank("monster", [song("Monster", "Red Velvet"),
                     song("Monster Mash", "Bobby Pickett", source="library")])
check("better catalog beats library", r[0]["title"], "Monster")

# --- unicode and punctuation ---
r = rank("dont stop me now", [song("Don't Stop Me Now", "Queen")])
check("apostrophe insensitive", len(r), 1)
r = rank("아이유", [song("아이유", "IU")])
check("hangul matches", len(r), 1)

# --- irrelevant results are dropped, not ranked low ---
r = rank("bohemian rhapsody", [song("Thriller", "Michael Jackson")])
check("unrelated dropped", r, [])

# --- decisiveness gate ---
check("decisive when clear",
      m.decisive(rank("bohemian rhapsody", [
          song("Bohemian Rhapsody", "Queen"),
          song("Bohemian Rhapsody Karaoke Mix", "Party Tyme")])), True)
check("ambiguous when two exact titles differ only by artist",
      m.decisive(rank("bohemian rhapsody", [
          song("Bohemian Rhapsody", "Queen"),
          song("Bohemian Rhapsody", "Pentatonix")])), False)
check("not decisive on empty", m.decisive([]), False)

# --- dedupe keeps the higher-scoring copy ---
d = m.dedupe([dict(song("Monster", "Red Velvet"), _score=50),
              dict(song("Monster", "Red Velvet", source="library"), _score=90)])
check("dedupe collapses", len(d), 1)
check("dedupe keeps best", d[0]["_score"], 90)

# --- tied covers resolve by the catalog's own popularity order ---
def api(title, artist, i):
    return dict(song(title, artist), _api_rank=i)

r = rank("yesterday", [api("Yesterday", "Mary Mary", 1),
                       api("Yesterday", "The Beatles", 0)])
check("popularity breaks a tie", r[0]["artist"], "The Beatles")
check("tied covers still decisive", m.decisive(r), True)

# A tie the catalog did not rank first must not be played blind.
r = rank("yesterday", [api("Yesterday", "Mary Mary", 3),
                       api("Yesterday", "Leona Lewis", 4)])
check("tie without a first-ranked hit is ambiguous", m.decisive(r), False)

# Library wins a tie even against the catalog's top result.
r = rank("monster", [api("Monster", "Someone Else", 0),
                     song("Monster", "Red Velvet", source="library")])
check("library outranks popular catalog tie", r[0]["source"], "library")

# A merely-partial top match stays ambiguous however it was ordered.
r = rank("monster", [api("Monster Mash", "Bobby Pickett", 0)])
check("partial match not decisive", m.decisive(r), False)

# A leading partial match is never decisive, however far ahead it is.
r = rank("monster m", [api("Monster Mash", "Bobby Pickett", 0),
                       api("Monster", "Lady Gaga", 1)])
check("leading partial stays ambiguous", m.decisive(r), False)
check("but it is still ranked first", r[0]["title"], "Monster Mash")

# --- owning the track settles an otherwise tied field ---
# Covers score the same 100 for the title, so without this a song already in
# the library would always ask before playing.
r = rank("yesterday", [api("Yesterday", "Mary Mary", 0),
                       api("Yesterday", "Leona Lewis", 1),
                       song("Yesterday", "The Beatles", source="library")])
check("owned track ranks first", r[0]["source"], "library")
check("owned track plays without asking", m.decisive(r), True)

# ...but owning a merely-partial match is still a guess.
r = rank("monster m", [song("Monster Mash", "Bobby Pickett", source="library"),
                       api("Monster", "Lady Gaga", 0)])
check("owned partial still asks", m.decisive(r), False)

# --- a subscription-playlist track counts as playable ---
# Apple Music's own playlists hold shared tracks that play through AppleScript,
# so they rank as library hits and carry the playlist they came from.
r = rank("hype boy", [api("Hype Boy", "NewJeans", 0),
                      dict(song("Hype Boy", "뉴진스", source="library"),
                           playlist="K-Pop: 2022")])
check("playable track outranks its catalog copy", r[0]["source"], "library")
check("playable track plays without asking", m.decisive(r), True)
check("the playlist it came from is kept", r[0].get("playlist"), "K-Pop: 2022")

if FAILED:
    print(f"FAIL ({len(FAILED)})")
    for f in FAILED:
        print("  -", f)
    sys.exit(1)
print("all ranking tests passed")
