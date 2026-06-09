"""
Parse job notifications from @OffersHunterBot messages.

Message format (as seen in real captures):
  [Title](https://upwork.com/jobs/~id)   <- hyperlink on first line
  Description snippet...

  🕐 Posted On: 2026-05-10 12:49:49
  🔧 Category: Digital Marketing | Sales & Marketing
  🌍 Country: United States
  💰 Hourly: $0 - $0  (or Budget: $200)
  🔑 Keywords: google ad, google ads
  🏆 Spent: $27,168 | Avg rate: $89.49
  🔗 Specialization: Main
"""

import re

# ISO 2-letter code → full country name
ISO_TO_COUNTRY = {
    'US': 'United States', 'CA': 'Canada', 'GB': 'United Kingdom',
    'AU': 'Australia', 'DE': 'Germany', 'FR': 'France',
    'IN': 'India', 'BR': 'Brazil', 'MX': 'Mexico',
    'NL': 'Netherlands', 'SE': 'Sweden', 'NO': 'Norway',
    'DK': 'Denmark', 'FI': 'Finland', 'CH': 'Switzerland',
    'AT': 'Austria', 'BE': 'Belgium', 'ES': 'Spain',
    'IT': 'Italy', 'PL': 'Poland', 'UA': 'Ukraine',
    'IL': 'Israel', 'AE': 'United Arab Emirates', 'SG': 'Singapore',
    'NZ': 'New Zealand', 'ZA': 'South Africa', 'IE': 'Ireland',
    'PT': 'Portugal', 'GR': 'Greece', 'TR': 'Turkey',
    'JP': 'Japan', 'KR': 'South Korea', 'CN': 'China',
    'HK': 'Hong Kong', 'PK': 'Pakistan', 'BD': 'Bangladesh',
    'PH': 'Philippines', 'ID': 'Indonesia', 'MY': 'Malaysia',
    'NG': 'Nigeria', 'KE': 'Kenya', 'EG': 'Egypt',
    'AR': 'Argentina', 'CO': 'Colombia', 'CL': 'Chile',
    'RU': 'Russia', 'CZ': 'Czech Republic', 'SK': 'Slovakia',
    'HU': 'Hungary', 'RO': 'Romania', 'BG': 'Bulgaria',
    'HR': 'Croatia', 'RS': 'Serbia', 'LT': 'Lithuania',
    'LV': 'Latvia', 'EE': 'Estonia', 'BY': 'Belarus',
    'TH': 'Thailand', 'VN': 'Vietnam', 'TW': 'Taiwan',
    'LK': 'Sri Lanka', 'MM': 'Myanmar', 'KH': 'Cambodia',
    'SA': 'Saudi Arabia', 'QA': 'Qatar', 'KW': 'Kuwait',
    'BH': 'Bahrain', 'OM': 'Oman', 'JO': 'Jordan',
    'MA': 'Morocco', 'TN': 'Tunisia', 'GH': 'Ghana',
    'TZ': 'Tanzania', 'ET': 'Ethiopia', 'CI': 'Ivory Coast',
    'PE': 'Peru', 'VE': 'Venezuela', 'EC': 'Ecuador',
    'UY': 'Uruguay', 'PY': 'Paraguay', 'BO': 'Bolivia',
}

def normalize_country(raw):
    """Convert ISO code or messy string to clean full country name."""
    if not raw:
        return None
    cleaned = raw.strip().rstrip('.,')
    # If it's a 2-letter ISO code
    if re.match(r'^[A-Z]{2}$', cleaned.upper()):
        return ISO_TO_COUNTRY.get(cleaned.upper(), cleaned)
    # If it starts with a 2-letter code followed by space + name (e.g. "AU Australia")
    m = re.match(r'^([A-Z]{2})\s+(.+)$', cleaned)
    if m and m.group(1) in ISO_TO_COUNTRY:
        return ISO_TO_COUNTRY[m.group(1)]
    return cleaned


def _first(patterns, text, flags=re.IGNORECASE):
    for pat in patterns:
        m = re.search(pat, text, flags)
        if m:
            return m.group(1).strip()
    return None


def _extract_upwork_id(url):
    if not url:
        return None
    # Match ~ID in any position (works for both /jobs/~ID and /nx/.../~ID)
    m = re.search(r"~([0-9a-f]{16,})", url, re.IGNORECASE)
    return m.group(1) if m else None


def parse_message(text: str) -> dict:

    # ----- URL ---------------------------------------------------------------
    # Match both www.upwork.com and upwork.com, old /jobs/ and new /nx/ paths
    url = _first([
        r"(https?://(?:www\.)?upwork\.com/jobs/[^\s\)\"]+)",
        r"(https?://(?:www\.)?upwork\.com/nx/[^\s\)\"]+)",
        r"(https?://(?:www\.)?upwork\.com/[^\s\)\"]+)",
    ], text)
    # Normalise to www.upwork.com so stored URLs are consistent
    if url:
        url = url.replace("://upwork.com/", "://www.upwork.com/")
    upwork_job_id = _extract_upwork_id(url or "")

    # ----- Title -------------------------------------------------------------
    title = None
    link_match = re.search(r"\[([^\]]+)\]\(https?://[^)]+\)", text)
    if link_match:
        title = link_match.group(1).strip()
    if not title:
        title = _first([r"\*\*(.+?)\*\*", r"\*([^\n*]{10,})\*", r"Title[:\s]+(.+)"], text)
    if not title:
        for line in text.splitlines():
            line = line.strip()
            if not line: continue
            if re.search(r"https?://", line): continue
            if re.match(r"[🕐🔧🌍💰🔑🏆🔗📌💵📅🌎]", line): continue
            title = line
            break

    # ----- Hourly rate -------------------------------------------------------
    hourly_rate_min = None
    hourly_rate_max = None
    range_match = re.search(
        r"(?:Hourly|Budget|Rate)[^\n]*\$\s*([\d,.]+)\s*[-–]\s*\$?\s*([\d,.]+)",
        text, re.IGNORECASE
    )
    if range_match:
        hourly_rate_min = float(range_match.group(1).replace(",", ""))
        hourly_rate_max = float(range_match.group(2).replace(",", ""))
    else:
        plain_range = re.search(r"\$\s*([\d,.]+)\s*[-–]\s*\$?\s*([\d,.]+)\s*/?\s*hr", text, re.IGNORECASE)
        if plain_range:
            hourly_rate_min = float(plain_range.group(1).replace(",", ""))
            hourly_rate_max = float(plain_range.group(2).replace(",", ""))
        else:
            single = re.search(r"\$\s*([\d,.]+)\s*/\s*hr", text, re.IGNORECASE)
            if single:
                hourly_rate_min = float(single.group(1).replace(",", ""))
                hourly_rate_max = hourly_rate_min

    if hourly_rate_min == 0 and hourly_rate_max == 0:
        hourly_rate_min = None
        hourly_rate_max = None

    # ----- Fixed budget ------------------------------------------------------
    fixed_budget = _first([
        r"Budget[:\s]+\$\s*([\d,.]+)(?!\s*/\s*hr)",
        r"Fixed[:\s]+\$\s*([\d,.]+)",
    ], text)

    # ----- Country -----------------------------------------------------------
    raw_country = _first([
        r"Country[:\s]+([A-Za-z ,]+?)(?:\n|$)",
        r"🌍\s*([A-Za-z ,]+?)(?:\n|$)",
        r"🌎\s*([A-Za-z ,]+?)(?:\n|$)",
    ], text)
    client_country = normalize_country(raw_country)

    # ----- Category ----------------------------------------------------------
    # Anchor to start-of-line and require a literal colon: the OffersHunterBot
    # metadata line reads "🔧 Category: Digital Marketing | …" and lives on
    # its own line. Without `(?:^|\n)` the regex matches the FIRST "category"
    # anywhere in the message — which happily collides with body text like
    # "…for the category terms (where we have the primary keywords…)" and
    # captures description text as the category value. Same fix below for
    # Keywords.
    category = _first([
        r"(?:^|\n)\s*🔧[^\n]*Category\s*:\s*(.+?)(?:\n|$)",
        r"(?:^|\n)\s*Category\s*:\s*(.+?)(?:\n|$)",
        r"(?:^|\n)\s*🔧\s+([A-Z][^\n:]{2,80})(?:\n|$)",
    ], text)

    # ----- Client spend ------------------------------------------------------
    client_spend = _first([
        r"Spent[:\s]+(\$[\d,.]+[kKmM+]*)(?:\s*\|)?",
        r"🏆\s*Spent[:\s]+(\$[\d,.]+[kKmM+]*)",
        r"Total spent[:\s]+(\$[\d,.]+[kKmM+]*)",
    ], text)

    # ----- Avg rate ----------------------------------------------------------
    avg_rate = _first([
        r"Avg rate[:\s]+\$\s*([\d,.]+)",
        r"Average rate[:\s]+\$\s*([\d,.]+)",
    ], text)

    # ----- Keywords ----------------------------------------------------------
    # Same anchoring fix as Category — without `(?:^|\n)` the bare "keywords"
    # in a body sentence ("...the primary keywords in the H1...") would
    # short-circuit the actual "🔑 Keywords: google ad, …" metadata line.
    keywords = _first([
        r"(?:^|\n)\s*🔑\s*Keywords\s*:\s*(.+?)(?:\n|$)",
        r"(?:^|\n)\s*Keywords\s*:\s*(.+?)(?:\n|$)",
        r"(?:^|\n)\s*🔑\s+([^\n:]{2,200})(?:\n|$)",
    ], text)

    # ----- Posted date -------------------------------------------------------
    posted_date = _first([
        r"Posted On[:\s]+(.+?)(?:\n|$)",
        r"🕐\s*Posted On[:\s]+(.+?)(?:\n|$)",
        r"Posted[:\s]+(.+?)(?:\n|$)",
    ], text)

    # ----- Description snippet -----------------------------------------------
    skip_patterns = re.compile(
        r"^(https?://|🕐|🔧|🌍|🌎|💰|🔑|🏆|🔗|📌|💵|📅|"
        r"Posted|Category|Country|Budget|Rate|Spent|Keywords|Specialization|"
        r"DISCLAIMER|NON-AFFILIATION|UPWORK\.COM)",
        re.IGNORECASE
    )
    desc_lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped: continue
        if skip_patterns.search(stripped): continue
        if title and stripped == title: continue
        if re.match(r"\[.+\]\(https?://", stripped): continue
        desc_lines.append(stripped)

    description_snippet = " ".join(desc_lines)[:5000] or None

    return {
        "upwork_job_id": upwork_job_id,
        "title": title,
        "url": url,
        "description_snippet": description_snippet,
        "hourly_rate_min": hourly_rate_min,
        "hourly_rate_max": hourly_rate_max,
        "client_country": client_country,
        "client_spend": client_spend,
        "avg_rate": avg_rate,
        "posted_date": posted_date,
        "category": category,
        "keywords": keywords,
        "fixed_budget": fixed_budget,
    }
