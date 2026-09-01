"""Ad-hoc download endpoint for the Round 2 SPOT vs iQuote analysis workbook."""
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

_ASSETS = Path(__file__).resolve().parent.parent / "static_assets"


@router.get("/round2")
def download_round2_report():
    fp = _ASSETS / "SPOT_vs_iQuote_Round2.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(
        path=str(fp),
        filename="SPOT_vs_iQuote_Round2.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/jobtype")
def download_jobtype_report():
    fp = _ASSETS / "SPOT_JobType_Variance.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(
        path=str(fp),
        filename="SPOT_JobType_Variance.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/distribution")
def download_distribution_chart():
    fp = _ASSETS / "SPOT_Variance_Distribution.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(
        path=str(fp),
        filename="SPOT_Variance_Distribution.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/customer")
def download_customer_chart():
    fp = _ASSETS / "SPOT_Customer_QtyBand_Chart.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(
        path=str(fp),
        filename="SPOT_Customer_QtyBand_Chart.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
