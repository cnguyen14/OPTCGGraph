"""Known OPTCG family names for parsing optcgapi sub_types field.

The optcgapi sub_types field concatenates multiple families with spaces,
e.g. "Straw Hat Crew Supernovas" means two families: "Straw Hat Crew" and "Supernovas".
Since family names themselves contain spaces, we need a known list to parse correctly.

This list is sorted longest-first for greedy matching.
"""

KNOWN_FAMILIES: list[str] = sorted([
    # Pirate Crews
    "Straw Hat Crew",
    "Big Mom Pirates",
    "Whitebeard Pirates",
    "Red-Haired Pirates",
    "Animal Kingdom Pirates",
    "Donquixote Pirates",
    "Heart Pirates",
    "Kid Pirates",
    "Blackbeard Pirates",
    "Roger Pirates",
    "Arlong Pirates",
    "Thriller Bark Pirates",
    "Kuja Pirates",
    "Buggy Pirates",
    "Foxy Pirates",
    "Bonney Pirates",
    "Krieg Pirates",
    "Rumbar Pirates",
    "Caribou Pirates",
    "Spade Pirates",
    "Hawkins Pirates",
    "On-Air Pirates",
    "Drake Pirates",
    "Barto Club Pirates",
    "Beautiful Pirates",
    "Fallen Monk Pirates",
    "Firetank Pirates",
    "Gyro Pirates",
    "Treasure Pirates",
    "World Pirates",
    "New Giant Pirate Crew",
    "Fake Straw Hat Crew",
    "FILM Straw Hat Crew",
    "Film Straw Hat Crew",

    # Organizations & Affiliations
    "The Seven Warlords of the Sea",
    "The Four Emperors",
    "The Vinsmoke Family",
    "The Akazaya Nine",
    "The Sun Pirates",
    "The Flying Fish Riders",
    "The House of Lambs",
    "The Pirates Fest",
    "Revolutionary Army",
    "World Government",
    "Baroque Works",
    "Cross Guild",
    "GERMA 66",
    "Kingdom of GERMA",
    "Celestial Dragons",
    "Monkey Mountain Alliance",
    "Mountain Bandits",
    "Happosui Army",
    "Accino Family",
    "Kouzuki Clan",

    # Navy & Government
    "Navy",
    "SWORD",
    "CP0",
    "CP6",
    "CP7",
    "CP9",
    "Former CP9",
    "Impel Down",
    "Jailer Beast",

    # Races & Species
    "Giant",
    "Minks",
    "Merfolk",
    "Fish-Man",
    "Lunarian",
    "Neptunian",
    "Animal",

    # Locations
    "East Blue",
    "Alabasta",
    "Sky Island",
    "Water Seven",
    "Dressrosa",
    "Punk Hazard",
    "Whole Cake Island",
    "Land of Wano",
    "Egghead",
    "Drum Kingdom",
    "Fish-Man Island",
    "Ohara",
    "Jaya",
    "Long Ring Long Land",
    "Mary Geoise",
    "Flevance",
    "Goa Kingdom",
    "Baterilla",
    "Foolshout Island",
    "Lulucia Kingdom",
    "Muggy Kingdom",
    "Sniper Island",
    "Windmill Village",
    "Frost Moon Village",
    "Shandian Warrior",
    "The Moon",

    # Supernovas & Categories
    "Supernovas",
    "Allies",
    "Plague",
    "SMILE",
    "Scientist",
    "Journalist",
    "Music",
    "Sprite",
    "Alchemi",
    "Botanist",
    "Biological Weapon",

    # Former affiliations
    "Former Baroque Works",
    "Former Navy",
    "Former Rocks Pirates",
    "Former Roger Pirates",
    "Former Whitebeard Pirates",
    "Former Arlong Pirates",

    # Special
    "ODYSSEY",
    "FILM",
    "Film",
    "Barto Club",
    "Weevil's Mother",

    # Catch-all short names that may appear
    "NULL",
], key=len, reverse=True)  # Longest first for greedy matching


def parse_families(sub_types: str) -> list[str]:
    """Parse optcgapi sub_types string into list of family names.

    Uses greedy longest-match against known family list.
    Unknown remainders are kept as-is.

    Examples:
        "Straw Hat Crew Supernovas" → ["Straw Hat Crew", "Supernovas"]
        "Big Mom Pirates" → ["Big Mom Pirates"]
        "Navy SWORD" → ["Navy", "SWORD"]
        "Kuja Pirates The Seven Warlords of the Sea" → ["Kuja Pirates", "The Seven Warlords of the Sea"]
    """
    if not sub_types or sub_types in ("?", "NULL", "1000", "2000", "5000"):
        return []

    result: list[str] = []
    remaining = sub_types.strip()

    while remaining:
        matched = False
        for family in KNOWN_FAMILIES:
            if remaining.startswith(family):
                rest = remaining[len(family):]
                if rest == "" or rest[0] == " ":
                    result.append(family)
                    remaining = rest.lstrip()
                    matched = True
                    break
        if not matched:
            # No known family matched — take the whole remainder as one family
            result.append(remaining)
            break

    return result
