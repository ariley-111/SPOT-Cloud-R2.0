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
    """Latest job-type × qty-band analysis (v3 — corrected component join)."""
    fp = _ASSETS / "SPOT_JobType_Variance_v3.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(
        path=str(fp),
        filename="SPOT_JobType_Variance_v3.xlsx",
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


@router.get("/whatif-print")
def download_whatif_scenarios():
    """Print-price what-if scenarios (10%/15%/20% cut in 1-49 and 200-999 bands)."""
    fp = _ASSETS / "SPOT_Print_WhatIf_Scenarios.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(
        path=str(fp),
        filename="SPOT_Print_WhatIf_Scenarios.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/band-5000plus-pcf-raw")
def download_5000plus_pcf_raw():
    """Raw joined rows in the 5000+ Print+Cut+Finishing band (Q224297 die-cut hand-formed)."""
    fp = _ASSETS / "SPOT_5000plus_PCF_RawJoined.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(
        path=str(fp),
        filename="SPOT_5000plus_PCF_RawJoined.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/band-1to49-raw")
def download_1to49_raw():
    """Raw joined rows in the 1-49 qty band (SPOT vs iQuote, with dims + cost breakdown)."""
    fp = _ASSETS / "SPOT_1to49_RawJoined.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(
        path=str(fp),
        filename="SPOT_1to49_RawJoined.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/print-parity")
def download_print_parity():
    fp = _ASSETS / "SPOT_vs_iQuote_Print.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(
        path=str(fp),
        filename="SPOT_vs_iQuote_Print.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/print-scenarios")
def download_print_scenarios():
    fp = _ASSETS / "Print_Speed_Scenarios.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(
        path=str(fp),
        filename="Print_Speed_Scenarios.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/print-before-after")
def download_print_before_after():
    fp = _ASSETS / "SPOT_vs_iQuote_Sell_BeforeAfter.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(path=str(fp), filename="SPOT_vs_iQuote_Sell_BeforeAfter.xlsx",
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.get("/cost-centers")
def download_cost_centers():
    fp = _ASSETS / "SPOT_vs_iQuote_CostCenters.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(path=str(fp), filename="SPOT_vs_iQuote_CostCenters.xlsx",
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.get("/print-actuals")
def download_print_actuals():
    fp = _ASSETS / "Print_Actuals_2026.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(path=str(fp), filename="Print_Actuals_2026.xlsx",
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.get("/print-factor-old-vs-new")
def download_print_factor():
    fp = _ASSETS / "Print_Factor_OldVsNew.xlsx"
    if not fp.exists():
        raise HTTPException(status_code=404, detail="Report not generated")
    return FileResponse(path=str(fp), filename="Print_Factor_OldVsNew.xlsx",
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
