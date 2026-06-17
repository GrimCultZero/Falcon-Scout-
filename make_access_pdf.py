from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
from reportlab.lib.enums import TA_CENTER

OUTPUT = "How to Share Google Ads Access.pdf"

doc = SimpleDocTemplate(OUTPUT, pagesize=A4,
    leftMargin=22*mm, rightMargin=22*mm, topMargin=22*mm, bottomMargin=22*mm)

DARK = colors.HexColor("#1a1a2e")
TEAL = colors.HexColor("#0a9396")
MUTED = colors.HexColor("#6b7280")
LIGHT = colors.HexColor("#f4f4f4")
WARN_BG = colors.HexColor("#fffbeb")
WARN = colors.HexColor("#b45309")

def S(n, **k): return ParagraphStyle(n, **k)

story = []

story.append(Paragraph("Access sharing — quick guide",
    S("T", fontName="Helvetica-Bold", fontSize=16, textColor=DARK, spaceAfter=4, leading=20)))
story.append(Paragraph("Please share access to the platforms below using the email address provided. Read-only access is fine if that's easier.",
    S("ST", fontName="Helvetica", fontSize=10, textColor=MUTED, spaceAfter=16, leading=14)))
story.append(HRFlowable(width="100%", thickness=1, color=TEAL, spaceAfter=14))

platforms = [
    ("Google Ads",              "ads.google.com → Admin → Access and security → + Add user"),
    ("Google Analytics 4",      "analytics.google.com → Admin → Account Access Management → + Add users"),
    ("Google Merchant Center",  "merchants.google.com → Settings → Account access → Add user\n(if running Shopping / PMax product ads)"),
    ("Google Tag Manager",      "tagmanager.google.com → Admin → User Management → + Add user\n(if you use GTM for tracking)"),
]

for name, path in platforms:
    story.append(Paragraph(name,
        S("PL", fontName="Helvetica-Bold", fontSize=11, textColor=DARK, spaceAfter=2, leading=14)))
    story.append(Paragraph(path,
        S("PA", fontName="Helvetica", fontSize=9, textColor=MUTED, spaceAfter=10, leading=13)))

story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e5e7eb"), spaceAfter=12))

# Email block
story.append(Paragraph("Use this email address:",
    S("EL", fontName="Helvetica-Bold", fontSize=11, textColor=DARK, spaceAfter=6)))

email_table = Table([
    [Paragraph("Primary", S("EK", fontName="Helvetica", fontSize=9, textColor=MUTED, leading=12)),
     Paragraph("analytics.itforce4@gmail.com",
        S("EV", fontName="Helvetica-Bold", fontSize=11, textColor=TEAL, leading=14))],
    [Paragraph("If limit exceeded", S("EK", fontName="Helvetica", fontSize=9, textColor=MUTED, leading=12)),
     Paragraph("analytics.itforce@gmail.com  |  analytics.itforce3@gmail.com  |  analytics.itforce2@gmail.com",
        S("EV2", fontName="Helvetica", fontSize=10, textColor=DARK, leading=14))],
], colWidths=[36*mm, None])
email_table.setStyle(TableStyle([
    ("BACKGROUND",    (0,0), (-1,-1), LIGHT),
    ("TOPPADDING",    (0,0), (-1,-1), 8),
    ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ("LEFTPADDING",   (0,0), (-1,-1), 12),
    ("RIGHTPADDING",  (0,0), (-1,-1), 12),
    ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
    ("LINEBELOW",     (0,0), (-1,0), 0.5, colors.HexColor("#d1d5db")),
]))
story.append(email_table)
story.append(Spacer(1, 10))
story.append(Paragraph(
    "Please let me know which email you used if you had to switch to a fallback.",
    S("N", fontName="Helvetica-Oblique", fontSize=9, textColor=MUTED, leading=12)))

doc.build(story)
print(f"Created: {OUTPUT}")
