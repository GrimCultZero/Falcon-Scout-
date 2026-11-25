"""Deleting campaigns and removing leads (F1 item 3, 25 Nov).

Only Metro's own tables are touched (leads, their hooks / touches / queued scrape jobs, imports, the
campaign). The Upwork tables, the suppression list, companies (they carry cached enrichment and are shared)
and every Phase 4+ history row (send log, replies) are never deleted:

  * a campaign can be deleted only while it is a `draft`, and only if none of its leads has a send-log or
    reply row (a draft cannot have any; this is the guard if someone changed the status by hand);
  * removing ticked leads skips, and reports, any lead with a send-log or reply row or a sent touch.
"""
from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from .db import (MetroCampaign, MetroHook, MetroImport, MetroLead, MetroReply, MetroScrapeJob, MetroSendLog, MetroTouch)


def _history_lead_ids(s: Session, lead_ids: list[int]) -> set[int]:
    """Leads that have real history (a send-log row, a reply, or a touch that went out)."""
    if not lead_ids:
        return set()
    busy: set[int] = set()
    for model in (MetroSendLog, MetroReply):
        busy |= {r[0] for r in s.query(model.lead_id).filter(model.lead_id.in_(lead_ids)).all() if r[0] is not None}
    busy |= {r[0] for r in s.query(MetroTouch.lead_id).filter(MetroTouch.lead_id.in_(lead_ids),
                                                              MetroTouch.status.in_(("sent", "unconfirmed", "scheduled"))).all()}
    return busy


def _delete_leads(s: Session, lead_ids: list[int]) -> int:
    if not lead_ids:
        return 0
    for i in range(0, len(lead_ids), 500):
        part = lead_ids[i:i + 500]
        s.query(MetroHook).filter(MetroHook.lead_id.in_(part)).delete(synchronize_session=False)
        s.query(MetroTouch).filter(MetroTouch.lead_id.in_(part)).delete(synchronize_session=False)
        s.query(MetroScrapeJob).filter(MetroScrapeJob.lead_id.in_(part), MetroScrapeJob.status == "queued") \
            .delete(synchronize_session=False)
        s.query(MetroScrapeJob).filter(MetroScrapeJob.lead_id.in_(part)).update({MetroScrapeJob.lead_id: None},
                                                                                synchronize_session=False)
        s.query(MetroLead).filter(MetroLead.id.in_(part)).delete(synchronize_session=False)
    return len(lead_ids)


def campaign_counts(s: Session, campaign: MetroCampaign) -> dict:
    cid = campaign.id
    ids = [r[0] for r in s.query(MetroLead.id).filter(MetroLead.campaign_id == cid).all()]
    return {"campaign": campaign.name, "status": campaign.status, "leads": len(ids),
            "imports": s.query(func.count(MetroImport.id)).filter(MetroImport.campaign_id == cid).scalar() or 0,
            "hooks": (s.query(func.count(MetroHook.id)).filter(MetroHook.lead_id.in_(ids)).scalar() or 0) if ids else 0,
            "touches": (s.query(func.count(MetroTouch.id)).filter(MetroTouch.lead_id.in_(ids)).scalar() or 0) if ids else 0,
            "queued_jobs": s.query(func.count(MetroScrapeJob.id)).filter(MetroScrapeJob.campaign_id == cid,
                                                                         MetroScrapeJob.status == "queued").scalar() or 0}


def delete_draft(s: Session, campaign: MetroCampaign) -> dict:
    """Delete a draft campaign with its leads and import records. Raises ValueError when it may not be deleted."""
    if campaign.status != "draft":
        raise ValueError("only a draft campaign can be deleted (this one is " + str(campaign.status) + ")")
    counts = campaign_counts(s, campaign)
    ids = [r[0] for r in s.query(MetroLead.id).filter(MetroLead.campaign_id == campaign.id).all()]
    if _history_lead_ids(s, ids):
        raise ValueError("a lead in this campaign has a sent message or a reply; it cannot be deleted")
    _delete_leads(s, ids)
    s.query(MetroScrapeJob).filter(MetroScrapeJob.campaign_id == campaign.id, MetroScrapeJob.status == "queued") \
        .delete(synchronize_session=False)
    s.query(MetroScrapeJob).filter(MetroScrapeJob.campaign_id == campaign.id).update({MetroScrapeJob.campaign_id: None},
                                                                                    synchronize_session=False)
    s.query(MetroImport).filter(MetroImport.campaign_id == campaign.id).delete(synchronize_session=False)
    s.delete(campaign)
    s.commit()
    return {"deleted": True, **counts}


def remove_leads(s: Session, campaign: MetroCampaign, lead_ids: list[int], *, dry_run: bool = False) -> dict:
    """Remove ticked leads from a campaign. Leads with history are kept and reported."""
    ids = sorted({int(i) for i in lead_ids})
    mine = [r[0] for r in s.query(MetroLead.id).filter(MetroLead.campaign_id == campaign.id, MetroLead.id.in_(ids)).all()] if ids else []
    busy = _history_lead_ids(s, mine)
    go = [i for i in mine if i not in busy]
    out = {"asked": len(ids), "removed": len(go), "not_in_campaign": len(ids) - len(mine),
           "kept_with_history": len(busy), "dry_run": dry_run}
    if dry_run:
        return out
    _delete_leads(s, go)
    s.commit()
    return out
