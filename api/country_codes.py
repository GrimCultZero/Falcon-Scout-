# -*- coding: utf-8 -*-
"""Country names for the codes Upwork's API sometimes sends (audit 2026-10-29, T21).

`exclude_countries` matches the NAME ("india"), but the Upwork API gives the client's
country as an ISO-3166 alpha-3 code ("IND", "USA", "GBR", "AUS") on some responses and
as a name on others. 12 Indian-client jobs got through in 10 days because "ind" does not
contain "india". normalize_country() turns a code into the name, once, at the point the
API row is built, and the filter matches on the normalised value, so a stored legacy
"IND" is caught too.

The frontend has the same alpha-3 list for flags (JobList.jsx / JobDetail.jsx);
tests/test_country_codes.py checks every code there is known here.
"""
ALPHA3_TO_NAME = {
    "AFG": "Afghanistan", "ALB": "Albania", "DZA": "Algeria", "AGO": "Angola", "ARG": "Argentina", "ARM": "Armenia",
    "AUS": "Australia", "AUT": "Austria", "AZE": "Azerbaijan", "BHR": "Bahrain", "BGD": "Bangladesh", "BLR": "Belarus",
    "BEL": "Belgium", "BLZ": "Belize", "BOL": "Bolivia", "BIH": "Bosnia and Herzegovina", "BRA": "Brazil", "BGR": "Bulgaria",
    "KHM": "Cambodia", "CMR": "Cameroon", "CAN": "Canada", "CHL": "Chile", "CHN": "China", "COL": "Colombia",
    "CRI": "Costa Rica", "HRV": "Croatia", "CYP": "Cyprus", "CZE": "Czech Republic", "DNK": "Denmark",
    "DOM": "Dominican Republic", "ECU": "Ecuador", "EGY": "Egypt", "SLV": "El Salvador", "EST": "Estonia",
    "ETH": "Ethiopia", "FIN": "Finland", "FRA": "France", "GEO": "Georgia", "DEU": "Germany", "GHA": "Ghana",
    "GRC": "Greece", "GTM": "Guatemala", "HND": "Honduras", "HKG": "Hong Kong", "HUN": "Hungary", "ISL": "Iceland",
    "IND": "India", "IDN": "Indonesia", "IRN": "Iran", "IRQ": "Iraq", "IRL": "Ireland", "ISR": "Israel", "ITA": "Italy",
    "JAM": "Jamaica", "JPN": "Japan", "JOR": "Jordan", "KAZ": "Kazakhstan", "KEN": "Kenya", "KWT": "Kuwait",
    "LVA": "Latvia", "LBN": "Lebanon", "LTU": "Lithuania", "LUX": "Luxembourg", "MYS": "Malaysia", "MLT": "Malta",
    "MEX": "Mexico", "MDA": "Moldova", "MAR": "Morocco", "MMR": "Myanmar", "NPL": "Nepal", "NLD": "Netherlands",
    "NZL": "New Zealand", "NIC": "Nicaragua", "NGA": "Nigeria", "MKD": "North Macedonia", "NOR": "Norway", "OMN": "Oman",
    "PAK": "Pakistan", "PAN": "Panama", "PRY": "Paraguay", "PER": "Peru", "PHL": "Philippines", "POL": "Poland",
    "PRT": "Portugal", "PRI": "Puerto Rico", "QAT": "Qatar", "ROU": "Romania", "RUS": "Russia", "SAU": "Saudi Arabia",
    "SRB": "Serbia", "SGP": "Singapore", "SVK": "Slovakia", "SVN": "Slovenia", "ZAF": "South Africa", "KOR": "South Korea",
    "ESP": "Spain", "LKA": "Sri Lanka", "SWE": "Sweden", "CHE": "Switzerland", "TWN": "Taiwan", "TZA": "Tanzania",
    "THA": "Thailand", "TUN": "Tunisia", "TUR": "Turkey", "UGA": "Uganda", "UKR": "Ukraine", "ARE": "United Arab Emirates",
    "GBR": "United Kingdom", "USA": "United States", "URY": "Uruguay", "UZB": "Uzbekistan", "VEN": "Venezuela",
    "VNM": "Vietnam", "ZWE": "Zimbabwe",
}


def normalize_country(raw):
    """A country NAME for a name or an alpha-3 code; anything unrecognised is returned unchanged
    (stripped), None stays None. "USA" -> "United States", "IND" -> "India"."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return s
    if len(s) == 3 and s.isalpha():
        return ALPHA3_TO_NAME.get(s.upper(), s)
    return s
