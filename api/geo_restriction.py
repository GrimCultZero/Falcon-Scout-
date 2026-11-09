# -*- coding: utf-8 -*-
"""What a stored `jobs.geo_restriction` value may look like (audit 2026-10-29, T20).

The analyser treats "United States only" as a hard disqualifier ("Artem cannot
legally apply", JobDetail.jsx), so a wrong value can turn a good job into a SKIP.
The scraper (upwork-enricher/content.js) used to write whatever text followed a
label, which produced "Skills and Expertise", "English: Strong working
proficiency", "- Tools: Google Ads / MCC, GA4, GTM, Hub" and, on 2026-10-29, two
false "United States only" stamps on Worldwide jobs.

The extension now writes a value only from (a) the exact sentence "Only freelancers
located in X may apply" or (b) a header label whose value is in the KNOWN set. This
module is the backend's copy of that rule, so an older extension, or any other
writer, cannot store a value the new scraper would refuse. tests/test_geo_restriction.py
checks the country list here equals the one embedded in content.js.

normalize_geo_value(raw) returns the value to store, or None to refuse it.
"""
import re

# Countries and regions as Upwork prints them (plus common short forms).
COUNTRIES = (
    "Afghanistan|Albania|Algeria|Andorra|Angola|Argentina|Armenia|Australia|Austria|Azerbaijan|Bahamas|Bahrain|"
    "Bangladesh|Barbados|Belarus|Belgium|Belize|Benin|Bhutan|Bolivia|Bosnia and Herzegovina|Botswana|Brazil|Brunei|"
    "Bulgaria|Burkina Faso|Burundi|Cambodia|Cameroon|Canada|Cape Verde|Chad|Chile|China|Colombia|Comoros|Congo|"
    "Costa Rica|Croatia|Cuba|Cyprus|Czech Republic|Czechia|Denmark|Dominican Republic|Ecuador|Egypt|El Salvador|"
    "Estonia|Eswatini|Ethiopia|Fiji|Finland|France|Gabon|Gambia|Georgia|Germany|Ghana|Greece|Guatemala|Guinea|Guyana|"
    "Haiti|Honduras|Hong Kong|Hungary|Iceland|India|Indonesia|Iran|Iraq|Ireland|Israel|Italy|Ivory Coast|Jamaica|"
    "Japan|Jordan|Kazakhstan|Kenya|Kosovo|Kuwait|Kyrgyzstan|Laos|Latvia|Lebanon|Lesotho|Liberia|Libya|Liechtenstein|"
    "Lithuania|Luxembourg|Macau|Madagascar|Malawi|Malaysia|Maldives|Mali|Malta|Mauritania|Mauritius|Mexico|Moldova|"
    "Monaco|Mongolia|Montenegro|Morocco|Mozambique|Myanmar|Namibia|Nepal|Netherlands|New Zealand|Nicaragua|Niger|"
    "Nigeria|North Macedonia|Norway|Oman|Pakistan|Palestine|Panama|Papua New Guinea|Paraguay|Peru|Philippines|Poland|"
    "Portugal|Puerto Rico|Qatar|Romania|Russia|Rwanda|Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|"
    "Slovakia|Slovenia|Somalia|South Africa|South Korea|South Sudan|Spain|Sri Lanka|Sudan|Suriname|Sweden|Switzerland|"
    "Syria|Taiwan|Tajikistan|Tanzania|Thailand|Togo|Trinidad and Tobago|Tunisia|Turkey|Turkmenistan|Uganda|Ukraine|"
    "United Arab Emirates|United Kingdom|United States|Uruguay|Uzbekistan|Venezuela|Vietnam|Yemen|Zambia|Zimbabwe|"
    "USA|US|UK|UAE|U.S.|U.S.A."
)
REGIONS = (
    "North America|South America|Latin America|Central America|Europe|European Union|EU|EMEA|Asia|Asia Pacific|APAC|"
    "Africa|Oceania|Middle East|Americas|Western Europe|Eastern Europe|Southeast Asia|Scandinavia|Nordics|Benelux"
)

KNOWN_PLACES = frozenset(s.lower() for s in (COUNTRIES + "|" + REGIONS).split("|"))
_US_FORMS = frozenset({"us", "usa", "u.s.", "u.s.a.", "u.s", "united states", "the united states", "the u.s.", "the us"})
# The form the sentence branch produces: "<place> only" (e.g. "United States only", "Canada only").
_ONLY_RE = re.compile(r"^(?P<place>[A-Za-z][A-Za-z .,'&()-]{0,58}?)\s+only$", re.I)


def _norm_place(p: str) -> str:
    p = re.sub(r"\s+", " ", p).strip().rstrip(".").strip()
    low = p.lower()
    if low in _US_FORMS or low.rstrip(".") in _US_FORMS:
        return "United States"
    if low in ("uk", "the uk", "u.k."):
        return "United Kingdom"
    return re.sub(r"^the\s+", "", p, flags=re.I)


def normalize_geo_value(raw):
    """The value to store for a scraped geo restriction, or None to refuse it."""
    if raw is None:
        return None
    s = re.sub(r"\s+", " ", str(raw)).strip()
    if not s or len(s) > 64 or "\n" in str(raw).strip():
        return None
    if s.lower() == "worldwide":
        return "Worldwide"
    m = _ONLY_RE.match(s)
    if m:
        # Every place named must be a known country or region ("United States or Canada
        # only" is fine; "English only" or free text is not).
        parts = [_norm_place(x) for x in re.split(r"\s*(?:,|\bor\b|\band\b|&)\s*", m.group("place"), flags=re.I) if x.strip()]
        if not parts or not all(x.lower() in KNOWN_PLACES for x in parts):
            return None
        return " or ".join(parts) + " only"
    place = _norm_place(s)
    if place.lower() in KNOWN_PLACES or s.lower() in KNOWN_PLACES:
        return place
    return None
