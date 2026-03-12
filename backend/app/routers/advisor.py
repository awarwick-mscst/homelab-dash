import io
import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.advisory import AdvisoryReport, AdvisoryFinding
from app.models.app_settings import AppSetting
from app.schemas.advisory import AdvisoryReportResponse
from app.services.advisor_engine import AdvisorEngine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/advisor", tags=["advisor"])

DEFAULT_SYSTEM_PROMPT = "You are a network security expert specializing in homelab environments. Be concise and actionable."


@router.post("/analyze", response_model=AdvisoryReportResponse)
async def run_analysis(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    engine = AdvisorEngine(db)
    report = await engine.run_analysis()
    return report


@router.get("/reports", response_model=list[AdvisoryReportResponse])
async def list_reports(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AdvisoryReport)
        .options(selectinload(AdvisoryReport.findings))
        .order_by(AdvisoryReport.created_at.desc())
        .limit(20)
    )
    return result.scalars().all()


@router.get("/reports/{report_id}", response_model=AdvisoryReportResponse)
async def get_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AdvisoryReport)
        .options(selectinload(AdvisoryReport.findings))
        .where(AdvisoryReport.id == report_id)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.post("/findings/{finding_id}/resolve")
async def resolve_finding(
    finding_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    finding = await db.get(AdvisoryFinding, finding_id)
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")
    finding.is_resolved = True
    finding.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "resolved"}


# --- PDF Report Download ---

def _sanitize_text(text: str) -> str:
    """Replace characters that latin-1 can't encode."""
    if not text:
        return text
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _generate_pdf(report: AdvisoryReport) -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Title
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 12, "Network Security Report", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 6, f"Generated: {report.created_at.strftime('%Y-%m-%d %H:%M UTC')}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # Score
    score = report.overall_score
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, f"Overall Security Score: {score:.0f}/100", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # Summary counts
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(0, 6, (
        f"Total findings: {report.total_findings}  |  "
        f"Critical: {report.critical_count}  |  High: {report.high_count}  |  "
        f"Medium: {report.medium_count}  |  Low: {report.low_count}  |  Info: {report.info_count}"
    ))
    pdf.ln(6)

    # AI Summary
    if report.ai_summary:
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 8, "AI Analysis", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 5, _sanitize_text(report.ai_summary))
        pdf.ln(6)

    # Findings grouped by severity
    severity_order = ["critical", "high", "medium", "low", "info"]
    severity_colors = {
        "critical": (220, 38, 38),
        "high": (234, 88, 12),
        "medium": (202, 138, 4),
        "low": (100, 116, 139),
        "info": (148, 163, 184),
    }

    findings = sorted(report.findings, key=lambda f: severity_order.index(f.severity.value) if f.severity.value in severity_order else 99)

    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "Findings & Remediation Steps", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    lm = pdf.l_margin

    for i, finding in enumerate(findings, 1):
        sev = finding.severity.value
        r, g, b = severity_colors.get(sev, (0, 0, 0))

        # Check if we need a new page (at least 40mm needed for a finding)
        if pdf.get_y() > 240:
            pdf.add_page()

        # Severity + Title
        pdf.set_x(lm)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(r, g, b)
        pdf.multi_cell(w=pdf.w - pdf.r_margin - lm, h=7, text=_sanitize_text(f"{i}. [{sev.upper()}] {finding.title}"))

        # Status
        pdf.set_x(lm)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", "", 9)
        status = "RESOLVED" if finding.is_resolved else "OPEN"
        pdf.multi_cell(w=pdf.w - pdf.r_margin - lm, h=5, text=f"Status: {status}  |  Category: {finding.category}")

        # Description
        pdf.set_x(lm)
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(w=pdf.w - pdf.r_margin - lm, h=5, text=_sanitize_text(f"Description: {finding.description}"))

        # Recommendation
        pdf.set_x(lm)
        pdf.set_font("Helvetica", "B", 10)
        pdf.multi_cell(w=pdf.w - pdf.r_margin - lm, h=5, text="Recommendation:")
        pdf.set_x(lm)
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(w=pdf.w - pdf.r_margin - lm, h=5, text=_sanitize_text(finding.recommendation))

        pdf.ln(4)

    return pdf.output()


@router.get("/reports/{report_id}/pdf")
async def download_report_pdf(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AdvisoryReport)
        .options(selectinload(AdvisoryReport.findings))
        .where(AdvisoryReport.id == report_id)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    try:
        pdf_bytes = _generate_pdf(report)
    except ImportError as e:
        logger.error("fpdf2 not installed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="PDF library (fpdf2) not installed on server. Run: pip install fpdf2")
    except Exception as e:
        logger.error("PDF generation failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")

    filename = f"security-report-{report.created_at.strftime('%Y%m%d-%H%M')}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- System Prompt Management ---

class SystemPromptUpdate(BaseModel):
    prompt: str


@router.get("/system-prompt")
async def get_system_prompt(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(AppSetting).where(AppSetting.key == "advisor_system_prompt"))
    setting = result.scalar_one_or_none()
    if setting and setting.value:
        prompt = json.loads(setting.value)
    else:
        prompt = DEFAULT_SYSTEM_PROMPT
    return {"prompt": prompt, "is_default": setting is None}


@router.put("/system-prompt")
async def update_system_prompt(
    data: SystemPromptUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(AppSetting).where(AppSetting.key == "advisor_system_prompt"))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = json.dumps(data.prompt)
    else:
        db.add(AppSetting(key="advisor_system_prompt", value=json.dumps(data.prompt)))
    await db.commit()
    return {"status": "updated"}


@router.delete("/system-prompt")
async def reset_system_prompt(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(AppSetting).where(AppSetting.key == "advisor_system_prompt"))
    setting = result.scalar_one_or_none()
    if setting:
        await db.delete(setting)
        await db.commit()
    return {"status": "reset", "prompt": DEFAULT_SYSTEM_PROMPT}
